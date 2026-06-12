# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time voice chat system for gaming scenarios. Supports multi-user rooms, live voice calls, mic toggle, member list, and voice activity indicators.

Self-hosted on domestic (China) servers with BGP multi-line + ICP filing. No commercial RTC clouds.

## Tech Stack (DO NOT SUBSTITUTE)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Media Server (SFU) | **mediasoup** (Node.js + TypeScript) | Audio stream forwarding |
| Signaling Server | **Node.js + TypeScript + ws** | Same process/repo as mediasoup |
| NAT Traversal | **coturn** (STUN/TURN) | For weak networks, added later |
| Web Client | **React + TypeScript + mediasoup-client** | For SFU validation |
| Windows Client | **C# + .NET 8 + WPF + WebSocketSharp + Concentus** | Primary client (PlainTransport/RTP, no WebRTC stack) |
| Audio Capture (C#) | **NAudio** | Mic capture/playback |
| Codec | **Opus** with **FEC** enabled | Forward error correction for weak networks |
| Deployment | **Docker / docker-compose** | Server containerization |

**Forbidden**: LiveKit, Janus, Agora/Tencent Cloud, MixedReality-WebRTC (deprecated), Electron.

## Repository Structure

Monorepo with three packages:

- `server/` — mediasoup SFU + WebSocket signaling (Node.js + TS)
- `web/` — React test client for SFU validation
- `windows/` — C# WPF client (WebSocketSharp + Concentus + NAudio)

## Build & Run Commands

### Server (Node.js + TypeScript)
```bash
cd server
npm install
npm run build        # Compile TypeScript
npm run dev          # Run with ts-node (development)
npm start            # Run compiled JS (production)
```

### Web Client (React)
```bash
cd web
npm install
npm run dev          # Dev server on localhost:5173
npm run build        # Production build
npm test             # Run tests
```

### Windows Client (C# WPF)
```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
```

## Architecture

### Signaling Flow (mediasoup)

The server uses a JSON-based WebSocket signaling protocol. Key message types:

1. `joinRoom` — Client joins a room, server responds with `joinedRoom` (includes `rtpCapabilities`)
2. `createTransport` — Client requests a new WebRTC or Plain transport (send or recv)
3. `connectTransport` — Client completes DTLS handshake on a WebRtcTransport
4. `produce` — Client starts sending media (microphone audio)
5. `consume` — Client requests to receive another peer's media
6. `resumeConsuming` — Client resumes a paused consumer

**Critical ordering**: Transport must be created → connected → then used to produce/consume. Skipping `connectTransport` will fail silently.

**Two transport types**:
- **WebRtcTransport** (browser client): requires ICE + DTLS negotiation
- **PlainTransport** (Windows client): raw RTP/UDP, comedia mode auto-detects remote address

### Audio Configuration

Fixed Opus codec: 48000 Hz sample rate, 2 channels, `useinbandfec=1` enabled.

### Room Management

- Rooms are created on-demand when first peer joins
- Each room has its own mediasoup Router
- Peers are tracked per-room with their Transport/Producer/Consumer state

## Development Rules

1. **mediasoup APIs must follow official documentation exactly.** Do not guess method names or parameters. If uncertain, ask for documentation.
2. Before implementing mediasoup transport/producer/consumer logic, write comments describing the full negotiation flow first.
3. **Never hardcode secrets** (keys, coturn credentials) in client code. Use server config or environment variables.
4. After implementing each module, provide specific local run/verify commands.
5. Focus on the current step only. Do not generate code for future steps prematurely.

## Development Sequence

High-risk items first. **Verify each step works before proceeding.**

1. **Step 1** — mediasoup SFU + WebSocket signaling server
2. **Step 2** — Web client validation (two browser tabs should hear each other)
3. **Step 3** — C# WPF minimal PoC (PlainTransport RTP direct, no SDP negotiation needed)
4. **Step 4** — C# WPF UI (room input, join/leave, mic toggle, member list, volume bars)
5. **Step 5** — coturn integration for real weak-network handling

## Key Constraints

- `config.ts` must have `announcedIp` field (server public IP); use `127.0.0.1` for local dev
- mediasoup Worker pool (one per CPU core) is created at startup; Router created per-room on round-robin Worker
- Server default port is **1985** (not 3000); Docker overrides to 3000 via `docker-compose.yml`
- Windows client uses **PlainTransport** (raw RTP/UDP), not WebRTC — no ICE/DTLS/SDP involved
