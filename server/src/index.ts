import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";
import { createWorkerPool, getNextWorker, getWorkerStats, closeAllWorkers } from "./mediasoupWorker";
import { Room } from "./room";
import { handleSignaling } from "./signaling";

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
    res.writeHead(404);
    res.end();
  });

  // 3. WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");
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
