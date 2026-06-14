import WebSocket from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { Room } from "./room";
import { verifyToken, AuthError } from "./auth";

interface SignalingMessage {
  type: string;
  roomId?: string;
  peerId?: string;
  transportId?: string;
  dtlsParameters?: mediasoupTypes.DtlsParameters;
  kind?: mediasoupTypes.MediaKind;
  rtpParameters?: mediasoupTypes.RtpParameters;
  producerId?: string;
  rtpCapabilities?: mediasoupTypes.RtpCapabilities;
  direction?: string;
  consumerId?: string;
  token?: string;
}

/**
 * Handle a WebSocket connection's signaling messages.
 *
 * Full transport negotiation flow:
 *
 * 1. joinRoom
 *    Client → { type:"joinRoom", roomId, peerId }
 *    Server → { type:"joinedRoom", roomId, peerId, rtpCapabilities, existingProducers[] }
 *
 * 2. createTransport (send or recv)
 *    Client → { type:"createTransport", direction:"send"|"recv" }
 *    Server → { type:"transportCreated", direction, id, iceParameters, iceCandidates, dtlsParameters }
 *
 * 3. connectTransport
 *    Client → { type:"connectTransport", transportId, dtlsParameters }
 *    Server → { type:"transportConnected", transportId }
 *
 * 4. produce (on send transport, after connect)
 *    Client → { type:"produce", kind, rtpParameters }
 *    Server → { type:"produced", producerId }
 *    Server broadcasts to others → { type:"newProducer", producerId, peerId, kind }
 *
 * 5. consume (on recv transport, after connect, when notified of newProducer)
 *    Client → { type:"consume", producerId, rtpCapabilities }
 *    Server → { type:"consumed", consumerId, producerId, kind, rtpParameters }
 *
 * 6. resumeConsuming (after client-side consumer is set up)
 *    Client → { type:"resumeConsuming", consumerId }
 *    Server → { type:"consumerResumed", consumerId }
 */
export function handleSignaling(
  ws: WebSocket,
  rooms: Map<string, Room>,
  roomClients: Map<string, Set<WebSocket>>,
  getNextWorker: () => mediasoupTypes.Worker
): void {
  let currentPeerId: string | null = null;
  let currentRoom: Room | null = null;
  let currentUserId: number | null = null;
  let currentDisplayName: string | null = null;

  ws.on("message", async (data: WebSocket.RawData) => {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      switch (msg.type) {
        case "authenticate":
          handleAuthenticate(msg);
          break;
        case "listRooms":
          handleListRooms();
          break;
        case "joinRoom":
          await handleJoinRoom(msg);
          break;
        case "createTransport":
          await handleCreateTransport(msg);
          break;
        case "connectTransport":
          await handleConnectTransport(msg);
          break;
        case "produce":
          await handleProduce(msg);
          break;
        case "consume":
          await handleConsume(msg);
          break;
        case "resumeConsuming":
          await handleResumeConsuming(msg);
          break;
        case "createPlainTransport":
          await handleCreatePlainTransport(msg);
          break;
        case "leaveRoom":
          handleLeaveRoom();
          break;
        case "closeProducer":
          handleCloseProducer(msg);
          break;
        default:
          send(ws, { type: "error", message: `Unknown type: ${msg.type}` });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Signaling error [${msg.type}]:`, message);
      send(ws, { type: "error", message });
    }
  });

  ws.on("close", () => {
    handleLeaveRoom();
  });

  function handleAuthenticate(msg: SignalingMessage): void {
    const { token } = msg;
    if (!token) {
      send(ws, { type: "authError", message: "Token required" });
      return;
    }

    try {
      const payload = verifyToken(token);
      currentUserId = payload.userId;
      currentDisplayName = payload.displayName || payload.username;
      send(ws, {
        type: "authenticated",
        userId: payload.userId,
        username: payload.username,
        displayName: payload.displayName,
      });
    } catch (error: unknown) {
      const message = error instanceof AuthError ? error.message : "Authentication failed";
      send(ws, { type: "authError", message });
    }
  }

  function handleListRooms(): void {
    const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
      roomId,
      peerCount: room.size,
    }));
    send(ws, { type: "roomsList", rooms: roomList });
  }

  async function handleJoinRoom(msg: SignalingMessage): Promise<void> {
    console.log(`[handleJoinRoom] Received joinRoom for roomId=${msg.roomId}, peerId=${msg.peerId}`);
    const { roomId } = msg;
    if (!roomId || typeof roomId !== "string" || roomId.length > 64 || !/^[a-zA-Z0-9_\-]+$/.test(roomId)) {
      throw new Error("roomId required (alphanumeric, max 64 chars)");
    }

    // Use authenticated display name if available, otherwise fall back to peerId from client.
    const peerId = currentDisplayName || msg.peerId;
    if (!peerId || typeof peerId !== "string" || peerId.length > 64) {
      throw new Error("peerId required (max 64 chars)");
    }

    // Leave previous room if any
    if (currentRoom && currentPeerId) {
      console.log(`[handleJoinRoom] Leaving previous room ${currentRoom.id} as ${currentPeerId}`);
      handleLeaveRoom();
    }

    // Get or create room
    let room = rooms.get(roomId);
    console.log(`[handleJoinRoom] Room lookup: ${room ? 'found' : 'not found'}`);
    if (!room) {
      console.log(`[handleJoinRoom] Creating new room: ${roomId}`);
      room = await Room.create(roomId, getNextWorker());
      rooms.set(roomId, room);
      console.log(`[handleJoinRoom] Room created and stored`);
    }

    room.addPeer(peerId);
    currentPeerId = peerId;
    currentRoom = room;
    console.log(`[handleJoinRoom] Peer ${peerId} added to room ${roomId}`);

    // Track WebSocket in room
    if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
    roomClients.get(roomId)!.add(ws);
    console.log(`[handleJoinRoom] WebSocket tracked in roomClients`);

    // Collect existing peers (excluding self)
    const existingPeers = room.getPeerIds().filter((id) => id !== peerId);
    console.log(`[handleJoinRoom] Existing peers: ${existingPeers.length}`);

    // Collect existing producers from other peers
    const existingProducers = room.getOtherProducers(peerId)
      .filter(p => p.appData && (p.appData as any).peerId)
      .map((p) => ({
        producerId: p.id,
        peerId: (p.appData as Record<string, unknown>)?.peerId as string,
      }));
    console.log(`[handleJoinRoom] Existing producers: ${existingProducers.length}`);

    const joinedRoomMsg = {
      type: "joinedRoom",
      roomId,
      peerId,
      rtpCapabilities: room.getRtpCapabilities(),
      existingPeers,
      existingProducers,
    };
    console.log(`[handleJoinRoom] Sending joinedRoom to ${peerId}:`, JSON.stringify({ existingPeers, existingProducersCount: existingProducers.length }));
    send(ws, joinedRoomMsg);
    console.log(`[handleJoinRoom] joinedRoom sent successfully`);

    // Notify others
    broadcast(roomId, peerId, { type: "peerJoined", peerId });
    console.log(`[handleJoinRoom] peerJoined broadcasted`);
  }

  async function handleCreateTransport(msg: SignalingMessage): Promise<void> {
    if (!currentRoom || !currentPeerId) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer) throw new Error("Peer not found");

    const transport = await currentRoom.createWebRtcTransport();
    const direction = msg.direction;

    if (direction === "send") {
      peer.sendTransport = transport;
    } else {
      peer.recvTransport = transport;
    }

    send(ws, {
      type: "transportCreated",
      direction,
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  }

  async function handleConnectTransport(msg: SignalingMessage): Promise<void> {
    if (!currentRoom || !currentPeerId) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer) throw new Error("Peer not found");

    const { transportId, dtlsParameters } = msg;
    if (!transportId) {
      throw new Error("transportId required");
    }

    const transport =
      peer.sendTransport?.id === transportId
        ? peer.sendTransport
        : peer.recvTransport?.id === transportId
          ? peer.recvTransport
          : null;

    if (!transport) throw new Error(`Transport ${transportId} not found`);

    // PlainTransport with comedia=true 不需要 connect，会自动检测远端地址
    // WebRtcTransport 需要 DTLS 参数
    if (dtlsParameters) {
      await transport.connect({ dtlsParameters });
    }

    send(ws, { type: "transportConnected", transportId });
  }

  async function handleProduce(msg: SignalingMessage): Promise<void> {
    if (!currentRoom || !currentPeerId) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer?.sendTransport) throw new Error("Send transport not ready");

    const { kind, rtpParameters } = msg;
    if (!kind || !rtpParameters) {
      throw new Error("kind and rtpParameters required");
    }

    const producer = await peer.sendTransport.produce({
      kind,
      rtpParameters,
      appData: { peerId: currentPeerId },
    });

    peer.producers.set(producer.id, producer);

    producer.on("transportclose", () => {
      peer.producers.delete(producer.id);
      if (currentRoom && currentPeerId) {
        broadcast(currentRoom.id, currentPeerId, {
          type: "producerClosed",
          producerId: producer.id,
          peerId: currentPeerId,
        });
      }
    });

    send(ws, { type: "produced", producerId: producer.id });

    // Notify others about new producer so they can consume
    broadcast(currentRoom.id, currentPeerId, {
      type: "newProducer",
      producerId: producer.id,
      peerId: currentPeerId,
      kind,
    });
  }

  async function handleConsume(msg: SignalingMessage): Promise<void> {
    if (!currentRoom || !currentPeerId) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer?.recvTransport) throw new Error("Recv transport not ready");

    const { producerId, rtpCapabilities } = msg;
    if (!producerId || !rtpCapabilities) {
      throw new Error("producerId and rtpCapabilities required");
    }

    if (!currentRoom.getRouter().canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume this producer");
    }

    // Create consumer in paused state — client resumes after local setup
    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    peer.consumers.set(consumer.id, consumer);

    consumer.on("transportclose", () => {
      peer.consumers.delete(consumer.id);
    });

    consumer.on("producerclose", () => {
      peer.consumers.delete(consumer.id);
      send(ws, { type: "consumerClosed", consumerId: consumer.id });
    });

    send(ws, {
      type: "consumed",
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  }

  async function handleResumeConsuming(msg: SignalingMessage): Promise<void> {
    if (!currentPeerId || !currentRoom) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer) throw new Error("Peer not found");

    const { consumerId } = msg;
    if (!consumerId) throw new Error("consumerId required");

    const consumer = peer.consumers.get(consumerId);
    if (!consumer) throw new Error(`Consumer ${consumerId} not found`);

    await consumer.resume();

    send(ws, { type: "consumerResumed", consumerId });
  }

  function handleCloseProducer(msg: SignalingMessage): void {
    if (!currentPeerId || !currentRoom) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer) throw new Error("Peer not found");

    const { producerId } = msg;
    if (!producerId) throw new Error("producerId required");

    const producer = peer.producers.get(producerId);
    if (!producer) {
      console.warn(`[closeProducer] Producer ${producerId} not found for peer ${currentPeerId}`);
      return;
    }

    producer.close();
    peer.producers.delete(producerId);
    console.log(`[closeProducer] Closed producer ${producerId} for peer ${currentPeerId}`);

    broadcast(currentRoom.id, currentPeerId, {
      type: "producerClosed",
      producerId,
      peerId: currentPeerId,
    });
  }

  async function handleCreatePlainTransport(msg: SignalingMessage): Promise<void> {
    if (!currentRoom || !currentPeerId) throw new Error("Not in a room");

    const peer = currentRoom.getPeer(currentPeerId);
    if (!peer) throw new Error("Peer not found");

    const transport = await currentRoom.createPlainTransport();
    const direction = msg.direction;

    if (direction === "send") {
      peer.sendTransport = transport;
    } else {
      peer.recvTransport = transport;
    }

    send(ws, {
      type: "plainTransportCreated",
      direction,
      id: transport.id,
      ip: transport.tuple.localIp,
      port: transport.tuple.localPort,
      rtcpPort: transport.rtcpTuple?.localPort,
    });
  }

  function handleLeaveRoom(): void {
    if (!currentRoom || !currentPeerId) return;

    const room = currentRoom;
    const peerId = currentPeerId;

    room.removePeer(peerId);

    // Remove WebSocket from room tracking
    const clients = roomClients.get(room.id);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) roomClients.delete(room.id);
    }

    broadcast(room.id, peerId, { type: "peerLeft", peerId });

    // Destroy room if empty
    if (room.size === 0) {
      rooms.delete(room.id);
      console.log(`Room ${room.id} destroyed (empty)`);
    }

    currentRoom = null;
    currentPeerId = null;
  }

  function broadcast(
    roomId: string,
    excludePeerId: string,
    message: Record<string, unknown>
  ): void {
    const clients = roomClients.get(roomId);
    if (!clients) return;

    const msg = JSON.stringify(message);
    for (const clientWs of clients) {
      if (clientWs !== ws && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(msg);
      }
    }
  }
}

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
