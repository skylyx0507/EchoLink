import { types as mediasoupTypes } from "mediasoup";

export const config = {
  // HTTP + WebSocket server port
  listenPort: 3000,

  // mediasoup Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 59999,
    logLevel: "warn" as mediasoupTypes.WorkerLogLevel,
    logTags: [
      "info",
      "ice",
      "dtls",
      "rtp",
      "srtp",
      "rtcp",
      "bwe",
      "score",
    ] as mediasoupTypes.WorkerLogTag[],
  },

  // Router media codecs — audio-only for voice chat
  mediaCodecs: [
    {
      kind: "audio" as mediasoupTypes.MediaKind,
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
      parameters: {
        "useinbandfec": 1,
      },
    },
  ] as unknown as mediasoupTypes.RtpCodecCapability[],

  // WebRtcTransport settings
  webRtcTransport: {
    // Server public IP. Change to actual public IP in production.
    // For local development, use 127.0.0.1.
    announcedIp: "127.0.0.1",
    listenIp: { ip: "0.0.0.0", announcedIp: "127.0.0.1" },
    initialAvailableOutgoingBitrate: 1000000,
  },
};
