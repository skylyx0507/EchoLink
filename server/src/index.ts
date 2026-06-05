import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";
import { createWorker } from "./mediasoupWorker";
import { Room } from "./room";
import { handleSignaling } from "./signaling";

/**
 * Entry point: starts HTTP server + WebSocket server + mediasoup Worker.
 *
 * Startup sequence:
 * 1. Create mediasoup Worker (spawns C++ subprocess)
 * 2. Start HTTP server (for health checks / future REST API)
 * 3. Start WebSocket server on top of HTTP server
 * 4. Handle incoming WebSocket connections via signaling module
 */

// Global state
const rooms = new Map<string, Room>();
const roomClients = new Map<string, Set<WebSocket>>();

async function main(): Promise<void> {
  // 1. Create mediasoup Worker
  const worker = await createWorker();

  // 2. HTTP server
  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", pid: worker.pid }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // 3. WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");
    handleSignaling(ws, rooms, roomClients, worker);
  });

  // 4. Start listening
  httpServer.listen(config.listenPort, () => {
    console.log(`Server listening on port ${config.listenPort}`);
    console.log(`mediasoup Worker PID: ${worker.pid}`);
    console.log(`Health check: http://localhost:${config.listenPort}/health`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("Shutting down...");
    wss.close();
    httpServer.close();
    worker.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
