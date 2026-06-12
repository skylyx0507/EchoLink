import { types } from "mediasoup-client";

// 信令消息类型
export interface JoinRoomMessage {
  type: "joinRoom";
  roomId: string;
  peerId: string;
}

export interface JoinedRoomMessage {
  type: "joinedRoom";
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
  transportId: string;
}

export interface ProduceMessage {
  type: "produce";
  kind: types.MediaKind;
  rtpParameters: types.RtpParameters;
}

export interface ProducedMessage {
  type: "produced";
  producerId: string;
}

export interface NewProducerMessage {
  type: "newProducer";
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
  consumerId: string;
}

export interface PeerJoinedMessage {
  type: "peerJoined";
  peerId: string;
}

export interface PeerLeftMessage {
  type: "peerLeft";
  peerId: string;
}

export interface ProducerClosedMessage {
  type: "producerClosed";
  producerId: string;
  peerId: string;
}

export interface AuthenticateMessage {
  type: "authenticate";
  token: string;
}

export interface AuthenticatedMessage {
  type: "authenticated";
  userId: number;
  username: string;
  displayName: string | null;
}

export interface AuthErrorMessage {
  type: "authError";
  message: string;
}

export interface ListRoomsMessage {
  type: "listRooms";
}

export interface RoomsListMessage {
  type: "roomsList";
  rooms: Array<{ roomId: string; peerCount: number }>;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  transportId?: string;
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
  | AuthenticateMessage
  | AuthenticatedMessage
  | AuthErrorMessage
  | ListRoomsMessage
  | RoomsListMessage
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
