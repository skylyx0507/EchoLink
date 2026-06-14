import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";
import { createWorkerPool, getNextWorker, getWorkerStats, closeAllWorkers } from "./mediasoupWorker";
import { Room } from "./room";
import { handleSignaling } from "./signaling";
import { login, register, verifyToken, AuthError } from "./auth";

/**
 * Entry point: starts HTTP server + WebSocket server + mediasoup Worker pool.
 *
 * Startup sequence:
 * 1. Create mediasoup Worker pool (one Worker per CPU core)
 * 2. Start HTTP server (health checks + REST API for auth and room list)
 * 3. Start WebSocket server on top of HTTP server
 * 4. Handle incoming WebSocket connections via signaling module
 */

// Global state
export const rooms = new Map<string, Room>();
export const roomClients = new Map<string, Set<WebSocket>>();

/**
 * Parse JSON request body.
 */
function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send a JSON response.
 */
function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  data: Record<string, unknown>
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Extract Bearer token from Authorization header.
 */
function getBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

async function main(): Promise<void> {
  // 1. Create mediasoup Worker pool
  const workers = await createWorkerPool();
  console.log(`Worker pool ready: ${workers.length} Workers`);

  // 2. HTTP server
  const httpServer = http.createServer(async (req, res) => {
    // Enable CORS for web client dev server.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "";

    if (url === "/health") {
      const stats = await getWorkerStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        workers: workers.length,
        rooms: rooms.size,
        workerPids: stats.map((s) => s.pid),
      }));
      return;
    }

    try {
      if (url === "/api/auth/register" && req.method === "POST") {
        const body = (await parseBody(req)) as { username?: string; password?: string; displayName?: string };
        if (!body.username || !body.password) {
          jsonResponse(res, 400, { error: "用户名和密码不能为空" });
          return;
        }
        const result = await register(body.username, body.password, body.displayName);
        jsonResponse(res, 201, { user: result.user, token: result.token });
        return;
      }

      if (url === "/api/auth/login" && req.method === "POST") {
        const body = (await parseBody(req)) as { username?: string; password?: string };
        if (!body.username || !body.password) {
          jsonResponse(res, 400, { error: "用户名和密码不能为空" });
          return;
        }
        const result = await login(body.username, body.password);
        jsonResponse(res, 200, { user: result.user, token: result.token });
        return;
      }

      if (url === "/api/rooms" && req.method === "GET") {
        const token = getBearerToken(req);
        // Both authenticated and anonymous users can list rooms.
        if (token) {
          try {
            verifyToken(token);
          } catch {
            jsonResponse(res, 401, { error: "无效的 token" });
            return;
          }
        }

        const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
          roomId,
          peerCount: room.size,
        }));
        jsonResponse(res, 200, { rooms: roomList });
        return;
      }
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        jsonResponse(res, 400, { error: error.message });
        return;
      }
      console.error("HTTP API error:", error);
      jsonResponse(res, 500, { error: "Internal server error" });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // 3. WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");
    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
    handleSignaling(ws, rooms, roomClients, getNextWorker);
  });

  // 4. Start listening
  httpServer.listen(config.listenPort, () => {
    console.log(`Server listening on port ${config.listenPort}`);
    console.log(`Workers: ${workers.map((w) => w.pid).join(", ")}`);
    console.log(`Health check: http://localhost:${config.listenPort}/health`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("Shutting down...");
    wss.close();
    httpServer.close();
    closeAllWorkers();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
