# EchoLink

> Real-time voice chat system for gaming — Self-hosted, Low-latency, Multi-platform

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)

**[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md)**

---

## 🎯 Overview

EchoLink is a real-time voice chat system designed for gaming scenarios. It supports multi-user rooms, microphone toggle, member lists, and voice activity detection (VAD).

- 🏠 **Self-hosted**: Deploy on your own servers, no dependency on commercial RTC cloud services
- ⚡ **Low Latency**: Built on mediasoup SFU architecture, end-to-end latency < 100ms
- 🎮 **Multi-platform**: Web browser + Windows desktop client
- 🔊 **High Quality**: Opus codec, 48kHz sample rate, FEC (Forward Error Correction) enabled
- 🛡️ **Weak Network Resilience**: STUN/TURN traversal for stable connections behind NAT

---

## 🏗️ Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Media Server (SFU) | **mediasoup** (Node.js + TypeScript) | Audio stream routing & forwarding |
| Signaling Server | **Node.js + TypeScript + ws** | WebSocket signaling protocol |
| NAT Traversal | **coturn** (STUN/TURN) | Connection resilience in weak networks |
| Web Client | **React + TypeScript + mediasoup-client** | Browser-based validation client |
| Windows Client | **C# + .NET 8 + WPF + NAudio** | Primary desktop client |
| Audio Codec | **Opus** (FEC enabled) | Forward error correction for packet loss |
| Deployment | **Docker / docker-compose** | Server containerization |

---

## 📁 Repository Structure

```
EchoLink/
├── server/          # mediasoup SFU + WebSocket signaling server
│   ├── src/
│   │   ├── index.ts          # Entry: HTTP + WebSocket + mediasoup Worker
│   │   ├── signaling.ts      # Signaling message handlers
│   │   ├── room.ts           # Room management
│   │   ├── peer.ts           # Peer state tracking
│   │   ├── config.ts         # Server configuration
│   │   └── mediasoupWorker.ts # Worker / Router initialization
│   └── package.json
├── web/             # React test client
│   ├── src/
│   │   ├── components/
│   │   │   └── Room.tsx      # Room UI component
│   │   ├── hooks/
│   │   │   └── useMediasoup.ts # mediasoup logic hook
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── windows/         # C# WPF desktop client
│   └── VoiceChat/
│       ├── MainWindow.xaml     # UI layout
│       ├── MainWindow.xaml.cs  # Business logic
│       └── VoiceChat.csproj
├── docker-compose.yml
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- .NET 8 SDK
- Docker (optional, for deployment)

### 1. Start the Server

```bash
cd server
npm install
npm run dev          # Development mode (ts-node)
# or
npm run build        # Compile TypeScript
npm start            # Production mode
```

The server listens on `ws://localhost:3000` by default.

### 2. Start the Web Client

```bash
cd web
npm install
npm run dev          # Vite dev server, default http://localhost:5173
```

Open two browser tabs, join the same room, and test bidirectional voice.

### 3. Start the Windows Client

```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
```

---

## 📡 Signaling Protocol

JSON-based WebSocket signaling protocol. Core message types:

| Message Type | Direction | Description |
|--------------|-----------|-------------|
| `joinRoom` | C→S | Join a room |
| `joinedRoom` | S→C | Join successful, returns RTP capabilities |
| `createTransport` | C→S | Create a WebRTC Transport |
| `transportCreated` | S→C | Transport created successfully |
| `connectTransport` | C→S | Complete DTLS handshake |
| `transportConnected` | S→C | Connection established |
| `produce` | C→S | Start sending audio |
| `produced` | S→C | Producer created successfully |
| `consume` | C→S | Request to receive another peer's audio |
| `consumed` | S→C | Consumer created successfully |
| `resumeConsuming` | C→S | Resume audio reception |
| `newProducer` | S→C (broadcast) | New peer started speaking |
| `producerClosed` | S→C (broadcast) | Peer stopped speaking |
| `peerJoined` / `peerLeft` | S→C (broadcast) | Peer entered/left room |

**Critical ordering**: Create Transport → Connect Transport → Produce/Consume. Skipping `connectTransport` will fail silently.

---

## 🎛️ Audio Configuration

- **Codec**: Opus
- **Sample Rate**: 48,000 Hz
- **Channels**: 2 (stereo)
- **FEC**: Enabled (`useinbandfec=1`)
- **Frame Size**: 20ms (960 samples)
- **Bitrate**: 64 kbps

---

## 🐳 Docker Deployment

```bash
docker-compose up -d
```

---

## 📝 Development Guidelines

1. **mediasoup and SIPSorcery APIs must follow official documentation exactly.** Do not guess method names or parameters.
2. Before implementing transport/producer/consumer logic, write comments describing the full negotiation flow first.
3. **Never hardcode secrets** (keys, coturn credentials) in client code. Use server config or environment variables.
4. After implementing each module, provide specific local run/verify commands.
5. Focus on the current step only. Do not generate code for future steps prematurely.

---

## 📄 License

[MIT](LICENSE)

---

## 🤝 Contributing

Issues and PRs are welcome!

- When reporting bugs, please attach browser Console logs and server logs
- When requesting features, describe the specific use case

---

*Made with ❤️ for gamers.*
