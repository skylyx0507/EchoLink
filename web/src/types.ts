import { types } from "mediasoup-client";

export const PROTOCOL_VERSION = 1;

export interface JoinRoomMessage {
  type: "joinRoom";
  version: number;
  roomId: string;
  peerId: string;
}

export interface JoinedRoomMessage {
  type: "joinedRoom";
  version?: number;
  roomId: string;
  peerId: string;
  rtpCapabilities: types.RtpCapabilities;
  existingPeers: string[];
  existingProducers: Array<{ producerId: string; peerId: string }>;
}

export interface CreateTransportMessage {
  type: "createTransport";
  direction: "send" | "recv";
}

export interface TransportCreatedMessage {
  type: "transportCreated";
  version?: number;
  direction: "send" | "recv";
  id: string;
  iceParameters: types.IceParameters;
  iceCandidates: types.IceCandidate[];
  dtlsParameters: types.DtlsParameters;
}

export interface ConnectTransportMessage {
  type: "connectTransport";
  transportId: string;
  dtlsParameters: types.DtlsParameters;
}

export interface TransportConnectedMessage {
  type: "transportConnected";
  version?: number;
  transportId: string;
}

export interface ProduceMessage {
  type: "produce";
  kind: types.MediaKind;
  rtpParameters: types.RtpParameters;
}

export interface ProducedMessage {
  type: "produced";
  version?: number;
  producerId: string;
}

export interface NewProducerMessage {
  type: "newProducer";
  version?: number;
  producerId: string;
  peerId: string;
  kind: types.MediaKind;
}

export interface ConsumeMessage {
  type: "consume";
  producerId: string;
  rtpCapabilities: types.RtpCapabilities;
}

export interface ConsumedMessage {
  type: "consumed";
  version?: number;
  consumerId: string;
  producerId: string;
  kind: types.MediaKind;
  rtpParameters: types.RtpParameters;
}

export interface ResumeConsumingMessage {
  type: "resumeConsuming";
  consumerId: string;
}

export interface ConsumerResumedMessage {
  type: "consumerResumed";
  version?: number;
  consumerId: string;
}

export interface PeerJoinedMessage {
  type: "peerJoined";
  version?: number;
  peerId: string;
}

export interface PeerLeftMessage {
  type: "peerLeft";
  version?: number;
  peerId: string;
}

export interface ProducerClosedMessage {
  type: "producerClosed";
  version?: number;
  producerId: string;
  peerId: string;
}

export interface ErrorMessage {
  type: "error";
  version?: number;
  message: string;
}

export type SignalingMessage =
  | JoinRoomMessage
  | JoinedRoomMessage
  | CreateTransportMessage
  | TransportCreatedMessage
  | ConnectTransportMessage
  | TransportConnectedMessage
  | ProduceMessage
  | ProducedMessage
  | NewProducerMessage
  | ConsumeMessage
  | ConsumedMessage
  | ResumeConsumingMessage
  | ConsumerResumedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | ProducerClosedMessage
  | ErrorMessage;

// 对等端信息
export interface PeerInfo {
  peerId: string;
  micEnabled?: boolean;
  audioConsumer?: types.Consumer;
  audioElement?: HTMLAudioElement;
}

// 房间状态
export interface RoomState {
  roomId: string;
  peerId: string;
  joined: boolean;
  micEnabled: boolean;
  peers: Map<string, PeerInfo>;
}
