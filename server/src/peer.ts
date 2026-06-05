import { types as mediasoupTypes } from "mediasoup";

export interface Peer {
  id: string;
  sendTransport: mediasoupTypes.WebRtcTransport | mediasoupTypes.PlainTransport | null;
  recvTransport: mediasoupTypes.WebRtcTransport | mediasoupTypes.PlainTransport | null;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export function createPeer(id: string): Peer {
  return {
    id,
    sendTransport: null,
    recvTransport: null,
    producers: new Map(),
    consumers: new Map(),
  };
}
