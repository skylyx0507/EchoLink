# EchoLink Server

> mediasoup SFU + WebSocket Signaling Server for EchoLink Voice Chat

## 🎯 Overview

This is the server-side component of EchoLink — a real-time voice chat system for gaming. It handles:

- **Audio stream routing** via mediasoup SFU (Selective Forwarding Unit)
- **WebSocket signaling** for WebRTC negotiation (ICE, DTLS, RTP)
- **Room management** — create/join/leave rooms, track peers
- **Producer/Consumer lifecycle** — manage who sends and receives audio

---

## 🏗️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| SFU Engine | **mediasoup** (v3.20) | Audio stream forwarding |
| Signaling | **ws** (WebSocket library) | JSON-based signaling protocol |
| Language | **TypeScript** | Type-safe server code |
| Runtime | **Node.js 18+** | Server runtime |
| Container | **Docker** | Deployment packaging |

---

## 📁 Directory Structure

```
server/
├── src/
│   ├── index.ts              # Entry point: HTTP + WebSocket + mediasoup Worker
│   ├── signaling.ts          # WebSocket message handlers (join, transport, produce, consume)
│   ├── room.ts               # Room class: Router, peer tracking, transport creation
│   ├── peer.ts               # Peer interface: transports, producers, consumers
│   ├── config.ts             # Server configuration (ports, IPs, codecs)
│   └── mediasoupWorker.ts    # mediasoup Worker & Router initialization
├── dist/                     # Compiled JavaScript (tsc output)
├── Dockerfile                # Docker image definition
├── test-signaling.js         # Simple WebSocket test client
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm

### Install Dependencies

```bash
cd server
npm install
```

### Development Mode (ts-node)

```bash
npm run dev
```

Server starts on:
- WebSocket: `ws://localhost:3000`
- HTTP health check: `http://localhost:3000/health`

### Production Mode

```bash
npm run build    # Compile TypeScript → dist/
npm start        # Run compiled JS
```

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_PORT` | `3000` | HTTP + WebSocket server port |
| `ANNOUNCED_IP` | `127.0.0.1` | Public IP for ICE candidates (set to your server IP) |
| `RTC_MIN_PORT` | `10000` | mediasoup UDP port range start |
| `RTC_MAX_PORT` | `10100` | mediasoup UDP port range end |

### Example

```bash
ANNOUNCED_IP=192.168.1.100 LISTEN_PORT=3000 npm run dev
```

---

## 📡 Signaling Protocol

The server uses a JSON-based WebSocket protocol. All messages have a `type` field.

### Client → Server

| Message | Description |
|---------|-------------|
| `joinRoom` | `{ roomId, peerId }` — Join or create a room |
| `createTransport` | `{ direction: "send" \| "recv" }` — Create WebRTC transport |
| `connectTransport` | `{ transportId, dtlsParameters }` — Complete DTLS handshake |
| `produce` | `{ kind, rtpParameters }` — Start sending audio |
| `consume` | `{ producerId, rtpCapabilities }` — Request receiving audio |
| `resumeConsuming` | `{ consumerId }` — Resume a paused consumer |
| `leaveRoom` | — Leave current room |

### Server → Client

| Message | Description |
|---------|-------------|
| `joinedRoom` | `{ roomId, peerId, rtpCapabilities, existingPeers, existingProducers }` |
| `transportCreated` | `{ id, iceParameters, iceCandidates, dtlsParameters }` |
| `transportConnected` | `{ transportId }` — DTLS complete |
| `produced` | `{ producerId }` — Producer created |
| `consumed` | `{ consumerId, producerId, kind, rtpParameters }` |
| `newProducer` | `{ producerId, peerId, kind }` — Broadcast: peer started speaking |
| `producerClosed` | `{ producerId, peerId }` — Broadcast: peer stopped speaking |
| `peerJoined` / `peerLeft` | `{ peerId }` — Broadcast |
| `error` | `{ message }` — Something went wrong |

### Critical Flow

```
joinRoom → createTransport(send) → connectTransport → produce
       → createTransport(recv) → connectTransport → consume → resumeConsuming
```

---

## 🐳 Docker

### Build & Run

```bash
docker build -t echolink-server .
docker run -p 3000:3000 -e ANNOUNCED_IP=YOUR_IP echolink-server
```

### Using docker-compose (from project root)

```bash
cd ..
docker-compose up -d
```

---

## 🧪 Testing

Use the included test client:

```bash
node test-signaling.js
```

Or use a WebSocket client (e.g., [websocat](https://github.com/vi/websocat)):

```bash
websocat ws://localhost:3000
```

Then send:
```json
{"type":"joinRoom","roomId":"test","peerId":"user1"}
```

---

## 📝 Development Notes

1. **mediasoup Worker** must be created before any Router or Transport
2. Each room gets its own **Router** — rooms are isolated
3. **PlainTransport** is used for the C# WPF client (raw RTP, no ICE/DTLS)
4. **WebRtcTransport** is used for browser clients (full ICE + DTLS)
5. The `announcedIp` in `config.ts` must be reachable by clients — use `127.0.0.1` for local dev, your public IP for production

---

## 📄 License

[MIT](../LICENSE)
