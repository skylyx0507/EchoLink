import { types as mediasoupTypes } from "mediasoup";

// 从环境变量获取服务器公网 IP
const announcedIp = process.env.ANNOUNCED_IP || "127.0.0.1";

export const config = {
  // HTTP + WebSocket server port
  listenPort: parseInt(process.env.LISTEN_PORT || "1985", 10),

  // mediasoup Worker settings
  worker: {
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT || "10000", 10),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || "59999", 10),
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
    announcedIp,
    listenIp: { ip: "0.0.0.0", announcedIp },
    initialAvailableOutgoingBitrate: 1000000,
  },
};
