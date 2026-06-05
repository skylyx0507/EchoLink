import WebSocket from "ws";
import { types as mediasoupTypes } from "mediasoup";
import { Room } from "./room";

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
  worker: mediasoupTypes.Worker
): void {
  let currentPeerId: string | null = null;
  let currentRoom: Room | null = null;

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
        case "leaveRoom":
          handleLeaveRoom();
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

  async function handleJoinRoom(msg: SignalingMessage): Promise<void> {
    const { roomId, peerId } = msg;
    if (!roomId || !peerId) throw new Error("roomId and peerId required");

    // Leave previous room if any
    if (currentRoom && currentPeerId) handleLeaveRoom();

    // Get or create room
    let room = rooms.get(roomId);
    if (!room) {
      room = await Room.create(roomId, worker);
      rooms.set(roomId, room);
    }

    room.addPeer(peerId);
    currentPeerId = peerId;
    currentRoom = room;

    // Track WebSocket in room
    if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
    roomClients.get(roomId)!.add(ws);

    // Collect existing producers from other peers
    const existingProducers = room.getOtherProducers(peerId).map((p) => ({
      producerId: p.id,
      peerId: (p.appData as Record<string, unknown>)?.peerId as string,
    }));

    send(ws, {
      type: "joinedRoom",
      roomId,
      peerId,
      rtpCapabilities: room.getRtpCapabilities(),
      existingProducers,
    });

    // Notify others
    broadcast(roomId, peerId, { type: "peerJoined", peerId });
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
    if (!transportId || !dtlsParameters) {
      throw new Error("transportId and dtlsParameters required");
    }

    const transport =
      peer.sendTransport?.id === transportId
        ? peer.sendTransport
        : peer.recvTransport?.id === transportId
          ? peer.recvTransport
          : null;

    if (!transport) throw new Error(`Transport ${transportId} not found`);

    await transport.connect({ dtlsParameters });

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
