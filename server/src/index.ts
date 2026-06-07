import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";
import { createWorkerPool, getNextWorker, getWorkerStats, closeAllWorkers } from "./mediasoupWorker";
import { Room } from "./room";
import { handleSignaling, AuthenticatedPeer } from "./signaling";
import { generateToken, verifyToken } from "./auth";

/**
 * Entry point: starts HTTP server + WebSocket server + mediasoup Worker pool.
 *
 * Startup sequence:
 * 1. Create mediasoup Worker pool (one Worker per CPU core)
 * 2. Start HTTP server (for health checks / future REST API)
 * 3. Start WebSocket server on top of HTTP server
 * 4. Handle incoming WebSocket connections via signaling module
 */

// Global state
const rooms = new Map<string, Room>();
const roomClients = new Map<string, Set<WebSocket>>();
const pendingRooms = new Map<string, Promise<Room>>();

async function main(): Promise<void> {
  // 1. Create mediasoup Worker pool
  const workers = await createWorkerPool();
  console.log(`Worker pool ready: ${workers.length} Workers`);

  // 2. HTTP server
  const httpServer = http.createServer(async (req, res) => {
    if (req.url === "/health") {
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

    if (req.url === "/token" && req.method === "POST") {
      if (!config.auth.secret) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (config.auth.adminKey) {
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${config.auth.adminKey}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { peerId, roomId, expiresIn } = JSON.parse(body);
          if (!peerId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "peerId required" }));
            return;
          }
          const payload: { peerId: string; roomId?: string; exp?: number } = { peerId };
          if (roomId) payload.roomId = roomId;
          if (expiresIn) payload.exp = Math.floor(Date.now() / 1000) + expiresIn;
          const token = generateToken(payload, config.auth.secret);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // 3. WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket, req) => {
    console.log("New WebSocket connection");

    let authenticatedPeer: AuthenticatedPeer | undefined;
    if (config.auth.secret) {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
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
      authenticatedPeer = { peerId: payload.peerId, roomId: payload.roomId };
      console.log(`Authenticated peer: ${payload.peerId}`);
    }

    handleSignaling(ws, rooms, roomClients, getNextWorker, pendingRooms, authenticatedPeer);
  });

  // 4. Start listening
  httpServer.listen(config.listenPort, () => {
    console.log(`Server listening on port ${config.listenPort}`);
    console.log(`Workers: ${workers.map((w) => w.pid).join(", ")}`);
    console.log(`Health check: http://localhost:${config.listenPort}/health`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    wss.close();
    for (const room of rooms.values()) room.close();
    rooms.clear();
    httpServer.close();
    closeAllWorkers();
    setTimeout(() => process.exit(0), 3000);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
