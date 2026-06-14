const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:1985");

ws.on("open", () => {
  console.log("Connected to signaling server");

  // Test 1: Join room
  ws.send(
    JSON.stringify({
      type: "joinRoom",
      roomId: "test-room",
      peerId: "peer-1",
    })
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("Received:", JSON.stringify(msg, null, 2));

  // After joining room, create send transport
  if (msg.type === "joinedRoom") {
    console.log("\n--- Creating send transport ---");
    ws.send(
      JSON.stringify({
        type: "createTransport",
        direction: "send",
      })
    );
  }

  // After transport created, connect it
  if (msg.type === "transportCreated") {
    console.log(`\n--- Connecting ${msg.direction} transport ---`);
    ws.send(
      JSON.stringify({
        type: "connectTransport",
        transportId: msg.id,
        dtlsParameters: msg.dtlsParameters,
      })
    );
  }

  // After transport connected
  if (msg.type === "transportConnected") {
    console.log("\n--- Transport connected successfully! ---");
    console.log("All signaling messages working correctly.");

    // Leave room and close
    ws.send(JSON.stringify({ type: "leaveRoom" }));
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 500);
  }

  if (msg.type === "error") {
    console.error("Error:", msg.message);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error.message);
  process.exit(1);
});

ws.on("close", () => {
  console.log("Disconnected");
});
