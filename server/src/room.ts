import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";
import { Peer, createPeer } from "./peer";
import { createRouter } from "./mediasoupWorker";

export class Room {
  public readonly id: string;
  private router: mediasoupTypes.Router;
  private peers: Map<string, Peer> = new Map();

  private constructor(id: string, router: mediasoupTypes.Router) {
    this.id = id;
    this.router = router;
  }

  /**
   * Create a new Room with its own Router.
   */
  static async create(
    id: string,
    worker: mediasoupTypes.Worker
  ): Promise<Room> {
    const router = await createRouter(worker);
    return new Room(id, router);
  }

  getRouter(): mediasoupTypes.Router {
    return this.router;
  }

  getRtpCapabilities(): mediasoupTypes.RtpCapabilities {
    return this.router.rtpCapabilities;
  }

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  addPeer(peerId: string): Peer {
    const peer = createPeer(peerId);
    this.peers.set(peerId, peer);
    return peer;
  }

  getPeer(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Close all producers
    for (const producer of peer.producers.values()) {
      producer.close();
    }
    // Close all consumers
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }
    // Close transports
    peer.sendTransport?.close();
    peer.recvTransport?.close();

    this.peers.delete(peerId);
  }

  getOtherProducers(peerId: string): mediasoupTypes.Producer[] {
    const producers: mediasoupTypes.Producer[] = [];
    for (const [id, peer] of this.peers) {
      if (id === peerId) continue;
      for (const producer of peer.producers.values()) {
        producers.push(producer);
      }
    }
    return producers;
  }

  /**
   * Create a WebRtcTransport for a peer.
   *
   * mediasoup WebRtcTransport negotiation flow:
   * 1. Server creates transport → returns { id, iceParameters, iceCandidates, dtlsParameters }
   * 2. Client creates RTCPeerConnection with these server-side params
   * 3. Client calls transport.connect({ dtlsParameters }) to complete DTLS handshake
   * 4. Then client can produce/consume on this transport
   */
  async createWebRtcTransport(): Promise<mediasoupTypes.WebRtcTransport> {
    const transport = await this.router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: "udp",
          ip: config.webRtcTransport.listenIp.ip,
          announcedIp: config.webRtcTransport.listenIp.announcedIp,
        },
        {
          protocol: "tcp",
          ip: config.webRtcTransport.listenIp.ip,
          announcedIp: config.webRtcTransport.listenIp.announcedIp,
        },
      ],
      initialAvailableOutgoingBitrate:
        config.webRtcTransport.initialAvailableOutgoingBitrate,
    });

    transport.on("icestatechange", (state) => {
      console.log(`WebRtcTransport ICE state: ${state} [id:${transport.id}]`);
    });

    transport.on("dtlsstatechange", (state) => {
      console.log(`WebRtcTransport DTLS state: ${state} [id:${transport.id}]`);
    });

    return transport;
  }

  /**
   * 创建 PlainTransport（用于 C# 等非浏览器客户端）
   * PlainTransport 接收原始 RTP，无需 ICE/DTLS
   * comedia=true 时自动检测远端地址
   */
  async createPlainTransport(): Promise<mediasoupTypes.PlainTransport> {
    const transport = await this.router.createPlainTransport({
      listenIp: config.webRtcTransport.listenIp,
      rtcpMux: true,
      comedia: true,
    });
    return transport;
  }

  getPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  get size(): number {
    return this.peers.size;
  }

  close(): void {
    for (const peer of this.peers.values()) {
      for (const p of peer.producers.values()) p.close();
      for (const c of peer.consumers.values()) c.close();
      peer.sendTransport?.close();
      peer.recvTransport?.close();
    }
    this.peers.clear();
    this.router.close();
  }
}
