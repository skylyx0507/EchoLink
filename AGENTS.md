# AGENTS.md

## Repo Layout

Monorepo, **no workspace root** — each package has independent dependencies and build:

| Package | Path | Stack | Entrypoint |
|---------|------|-------|------------|
| Server | `server/` | Node.js + TS + mediasoup 3.20 + ws | `src/index.ts` |
| Web | `web/` | React 19 + Vite 8 + TS 6 + mediasoup-client | `src/main.tsx` |
| Windows | `windows/` | .NET 8 + WPF + NAudio + Concentus + WebSocketSharp | `VoiceChat/MainWindow.xaml.cs` |

## Commands

### Server
```bash
cd server && npm install
npm run dev          # ts-node src/index.ts (listens on port 1985 by default)
npm run build        # tsc -> dist/
npm start            # node dist/index.js
```
No test script. `test-signaling.js` is a standalone manual test.

### Web
```bash
cd web && npm install
npm run dev          # Vite on :5173, proxies /ws to ws://localhost:1985
npm run build        # tsc -b && vite build
npm run lint         # eslint .
npm test             # vitest run (jsdom, setup: src/setupTests.ts)
```

### Windows
```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
# Production:
.\publish.ps1        # self-contained single-file win-x64 -> VoiceChat\bin\Release\net8.0-windows\win-x64\publish\EchoLink.exe
```

## Critical: CLAUDE.md Is Stale

The root `CLAUDE.md` contains outdated information. Trust the actual code over it:

- **Windows client does NOT use SIPSorcery.** It uses WebSocketSharp (signaling) + raw UDP/RTP (media) + Concentus (Opus codec). The `SoundFlow.Extensions.WebRtc.Apm` NuGet package handles noise suppression.
- **Windows client does NOT do SDP negotiation.** It uses mediasoup `PlainTransport` (raw RTP/UDP), bypassing WebRTC entirely.
- **Server default port is 1985** (in `server/src/config.ts`), not 3000. Docker-compose overrides to 3000. Vite proxy targets 1985.

## Key Gotchas

- **Signaling ordering is strict**: transport create -> connect -> produce/consume. Skipping `connectTransport` fails silently.
- **Consumers start paused**: must send `resumeConsuming` after `consume`.
- **Audio is Opus-only**: 48kHz, 2 channels, `useinbandfec=1`. No video anywhere.
- **Server `config.ts`** has a type assertion (`as unknown as mediasoupTypes.RtpCodecCapability[]`) on `mediaCodecs` — do not "fix" this, it's intentional for mediasoup's API.
- **Web client**: pure CSS (no framework), ~1100 lines in `App.css`. Theme via CSS variables.
- **Windows client**: native `librnnoise.dll` must exist in `windows/VoiceChat/lib/` for RNNoise denoising (optional, has fallback).
- **Windows `csproj`** pins `RuntimeIdentifier` to `win-x64` and `SelfContained=true`.

## Environment

Copy `.env.example` to `.env`. Key vars:
- `ANNOUNCED_IP` — server public IP for WebRTC ICE (use `127.0.0.1` for local dev)
- `LISTEN_PORT` — WebSocket port (default 1985)
- `RTC_MIN_PORT` / `RTC_MAX_PORT` — mediasoup UDP range (default 10000-10100)

## Architecture Notes

- **One mediasoup Worker**, all rooms share it via separate Routers.
- **Web client** uses `WebRtcTransport` (ICE + DTLS). **Windows client** uses `PlainTransport` (raw RTP/UDP).
- Signaling is JSON over WebSocket. Full protocol documented in `server/ARCHITECTURE.md`.
- Per-package AI context docs exist: `server/ARCHITECTURE.md`, `web/AI_CONTEXT.md`, `windows/CLAUDE.md`.

## Forbidden Tech

LiveKit, Janus, Agora, Tencent Cloud RTC, MixedReality-WebRTC, Electron. Do not introduce these.
