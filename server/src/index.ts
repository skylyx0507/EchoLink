import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config";
import { createWorkerPool, getNextWorker, getWorkerStats, closeAllWorkers } from "./mediasoupWorker";
import { Room } from "./room";
import { handleSignaling, AuthenticatedPeer } from "./signaling";
import { generateToken, verifyToken } from "./auth";
import { initDatabase, closeDatabase, createUser, verifyUser } from "./db";

const rooms = new Map<string, Room>();
const roomClients = new Map<string, Set<WebSocket>>();
const pendingRooms = new Map<string, Promise<Room>>();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function main(): Promise<void> {
  initDatabase();

  const workers = await createWorkerPool();
  console.log(`Worker pool ready: ${workers.length} Workers`);

  const httpServer = http.createServer(async (req, res) => {
    const url = req.url || "";
    const method = req.method || "GET";

    if (url === "/health" && method === "GET") {
      const stats = await getWorkerStats();
      jsonResponse(res, 200, {
        status: "ok",
        workers: workers.length,
        rooms: rooms.size,
        workerPids: stats.map((s) => s.pid),
      });
      return;
    }

    if (url === "/register" && method === "POST") {
      try {
        const { username, password } = JSON.parse(await readBody(req));
        const result = createUser(username, password);
        if (!result.success) {
          jsonResponse(res, 400, { error: result.error });
          return;
        }
        jsonResponse(res, 201, { success: true, userId: result.userId });
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    if (url === "/login" && method === "POST") {
      try {
        const { username, password } = JSON.parse(await readBody(req));
        const result = verifyUser(username, password);
        if (!result.success || !result.user) {
          jsonResponse(res, 401, { error: "用户名或密码错误" });
          return;
        }
        if (!config.auth.secret) {
          jsonResponse(res, 200, { success: true, userId: result.user.id, username: result.user.username });
          return;
        }
        const token = generateToken({
          userId: result.user.id,
          username: result.user.username,
        }, config.auth.secret);
        jsonResponse(res, 200, { success: true, token, userId: result.user.id, username: result.user.username });
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    if (url === "/token" && method === "POST") {
      if (!config.auth.secret) {
        jsonResponse(res, 404, { error: "Auth not enabled" });
        return;
      }
      if (config.auth.adminKey) {
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${config.auth.adminKey}`) {
          jsonResponse(res, 401, { error: "Unauthorized" });
          return;
        }
      }
      try {
        const { userId, username, roomId, expiresIn } = JSON.parse(await readBody(req));
        if (!userId || !username) {
          jsonResponse(res, 400, { error: "userId and username required" });
          return;
        }
        const payload: { userId: number; username: string; roomId?: string; exp?: number } = { userId, username };
        if (roomId) payload.roomId = roomId;
        if (expiresIn) payload.exp = Math.floor(Date.now() / 1000) + expiresIn;
        const token = generateToken(payload, config.auth.secret);
        jsonResponse(res, 200, { token });
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON" });
      }
      return;
    }

    if (url === "/api/rooms" && method === "GET") {
      const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
        id,
        peers: room.size,
      }));
      jsonResponse(res, 200, { rooms: roomList });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket, req) => {
    console.log("New WebSocket connection");

    let authenticatedPeer: AuthenticatedPeer | undefined;
    if (config.auth.secret) {
      const reqUrl = new URL(req.url || "", `http://${req.headers.host}`);
      const token = reqUrl.searchParams.get("token");
      if (!token) {
        console.log("Connection rejected: no token provided");
        ws.close(4001, "Authentication required");
        return;
      }
      const payload = verifyToken(token, config.auth.secret);
      if (!payload) {
        console.log("Connection rejected: invalid token");
        ws.close(4002, "Invalid or expired token");
        return;
      }
      authenticatedPeer = { userId: payload.userId, username: payload.username, roomId: payload.roomId };
      console.log(`Authenticated peer: ${payload.username} (id: ${payload.userId})`);
    }

    handleSignaling(ws, rooms, roomClients, getNextWorker, pendingRooms, authenticatedPeer);
  });

  httpServer.listen(config.listenPort, () => {
    console.log(`Server listening on port ${config.listenPort}`);
    console.log(`Workers: ${workers.map((w) => w.pid).join(", ")}`);
    console.log(`Health check: http://localhost:${config.listenPort}/health`);
    if (config.auth.secret) {
      console.log(`Auth: enabled (register: POST /register, login: POST /login)`);
    } else {
      console.log(`Auth: disabled (set AUTH_SECRET to enable)`);
    }
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    wss.close();
    for (const room of rooms.values()) room.close();
    rooms.clear();
    httpServer.close();
    closeAllWorkers();
    closeDatabase();
    setTimeout(() => process.exit(0), 3000);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
