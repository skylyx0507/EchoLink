import { types as mediasoupTypes } from "mediasoup";

const announcedIp = process.env.ANNOUNCED_IP || "127.0.0.1";

export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_VERSION = 1;

export const config = {
  listenPort: parseInt(process.env.LISTEN_PORT || "1985", 10),

  auth: {
    secret: process.env.AUTH_SECRET || "",
    adminKey: process.env.AUTH_ADMIN_KEY || "",
  },

  // mediasoup Worker settings
  worker: {
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT || "10000", 10),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || "10100", 10),
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
