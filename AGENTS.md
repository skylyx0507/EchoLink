# AGENTS.md

> 本文件面向 AI 编程助手。阅读者应当被假设对 EchoLink 项目一无所知。以下内容基于仓库实际文件与代码整理，保持与源码一致。

---

## 1. 项目概述

EchoLink 是一个面向游戏场景的**实时语音通话系统**，采用自托管 SFU（Selective Forwarding Unit）架构，功能类似 Discord 语音频道。

项目以 Monorepo 形式组织，包含三个子项目：

| 目录 | 技术栈 | 职责 |
|---|---|---|
| `server/` | Node.js 18+ + TypeScript 5.7 + mediasoup 3.20.0 + ws 8.18.0 | 媒体转发服务器（SFU）+ WebSocket 信令服务器 |
| `web/` | React 19.2 + TypeScript ~6.0 + Vite 8 + mediasoup-client 3.20.0 | 浏览器验证客户端，也用于功能验证 |
| `windows/` | .NET 8 + WPF + NAudio 2.2.1 + Concentus 2.2.2 + WebSocketSharp 1.0.3-rc11 | Windows 桌面主客户端，实际游戏场景使用 |

核心通信流程：

- 客户端与服务器通过 **WebSocket 交换 JSON 信令**。
- 浏览器客户端使用 **WebRtcTransport**（ICE + DTLS）。
- Windows 客户端使用 **PlainTransport**（原始 UDP/RTP，无 ICE/DTLS/SDP）。
- 服务器只转发音频，不混音；编解码器固定为 **Opus（48 kHz、2 通道、inband FEC）**。

---

## 2. 仓库结构

```
EchoLink/
├── server/              # mediasoup SFU + WebSocket 信令
│   ├── src/
│   │   ├── index.ts          # 入口：HTTP + WebSocket + mediasoup Worker 池
│   │   ├── config.ts         # 配置：端口、编解码器、WebRTC 参数
│   │   ├── mediasoupWorker.ts # Worker/Router 工厂（按 CPU 核心数创建 Worker 池）
│   │   ├── signaling.ts      # 信令消息路由（核心逻辑）
│   │   ├── room.ts           # Room 类（Router + Peer 集合）
│   │   ├── peer.ts           # Peer 接口（Transport/Producer/Consumer 状态）
│   │   ├── db.ts             # SQLite 用户账号持久化
│   │   └── auth.ts           # JWT 认证（注册/登录/校验）
│   ├── dist/                 # tsc 编译输出
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── ARCHITECTURE.md       # 服务端架构文档
│   └── test-signaling.js     # 简单 WebSocket 测试脚本
├── web/                 # React 浏览器客户端
│   ├── src/
│   │   ├── hooks/useMediasoup.ts    # 核心 Hook：信令 + WebRTC + 音频处理
│   │   ├── hooks/useAuth.ts         # 账号登录/注册状态管理
│   │   ├── hooks/useTheme.ts        # 主题管理 Hook
│   │   ├── components/Room.tsx      # 房间页主界面（Discord 风格）
│   │   ├── components/RoomList.tsx  # 房间一览页
│   │   ├── components/Login.tsx     # 登录页
│   │   ├── components/Register.tsx  # 注册页
│   │   ├── components/ThemeSwitcher.tsx
│   │   ├── components/Downloads.tsx
│   │   ├── themes.ts                # 5 套主题配置
│   │   ├── types.ts                 # 信令消息类型定义（与 server 对齐）
│   │   ├── App.tsx / main.tsx / App.css / index.css
│   │   ├── setupTests.ts
│   │   ├── themes.test.ts
│   │   ├── types.test.ts
│   │   └── components/Room.test.tsx
│   ├── public/             # 静态资源（WASM、AudioWorklet、图标等）
│   ├── package.json
│   ├── vite.config.ts      # Vite 配置 + WebSocket 代理
│   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│   ├── eslint.config.js
│   ├── Dockerfile          # 多阶段构建：Node → Nginx
│   └── nginx.conf          # 生产环境 SPA + WebSocket 代理
├── windows/             # C# WPF 桌面客户端
│   ├── VoiceChat/
│   │   ├── MainWindow.xaml / MainWindow.xaml.cs       # 主窗口 UI / 核心逻辑
│   │   ├── LoginWindow.xaml / LoginWindow.xaml.cs     # 登录窗口 UI / 连接入口
│   │   ├── RoomsWindow.xaml / RoomsWindow.xaml.cs     # 房间列表窗口
│   │   ├── AuthService.cs                             # HTTP 登录/注册/房间列表服务
│   │   ├── ErrorDialog.xaml / ErrorDialog.xaml.cs
│   │   ├── App.xaml / App.xaml.cs / AssemblyInfo.cs
│   │   ├── Audio/
│   │   │   ├── AdaptiveJitterBuffer.cs    # 多用户抖动缓冲 + 混音
│   │   │   ├── RnnoiseDenoiser.cs         # RNNoise P/Invoke 降噪封装
│   │   │   └── WebRtcNoiseSuppressor.cs   # WebRTC APM P/Invoke 降噪封装
│   │   ├── Native/             # 原生库目录（如 RNNoise DLL）
│   │   ├── lib/librnnoise.dll  # RNNoise 原生 DLL
│   │   └── VoiceChat.csproj    # 项目文件
│   ├── docs/
│   │   └── noise-suppression-research.md   # 降噪方案调研报告
│   ├── EchoLink.slnx           # 新版 Solution 文件
│   ├── EchoLink.sln            # 旧版 VS 解决方案
│   ├── publish.ps1             # 自包含单文件发布脚本
│   ├── installer.nsi           # NSIS 安装脚本
│   └── EchoLink-Setup-1.0.0.exe # 已构建的安装包
├── docker-compose.yml   # 一键部署 server + web
├── .env.example         # 环境变量模板
├── EchoLink.sln         # 根目录 VS 解决方案（指向 windows/VoiceChat）
├── README.md / README.zh-CN.md / README.ja-JP.md
└── CLAUDE.md            # 根目录 AI 指南
```

---

## 3. 技术栈与运行时架构

### 3.1 服务端

- **mediasoup 3.20.0**：C++ 子进程 Worker 负责媒体转发。
- **ws 8.18.0**：原生 WebSocket 服务器。
- 启动时按 CPU 核心数创建 Worker 池；新 Room 通过 round-robin 分配到不同 Worker。
- 每个 Room 拥有独立的 Router；Peer 在 Router 上创建 WebRtcTransport 或 PlainTransport。
- HTTP 服务器提供 `/health` 健康检查、`/api/auth/*` 认证接口、`/api/rooms` 房间列表接口，WebSocket 复用同端口。

### 3.2 Web 客户端

- React 19 + TypeScript + Vite 8。
- `mediasoup-client` 管理 Device、Transport、Producer、Consumer。
- 可选二次降噪：`@jitsi/rnnoise-wasm` + `public/enhanced-noise-suppressor.js` AudioWorklet。
- 使用 `navigator.mediaDevices` 枚举设备；`HTMLAudioElement.setSinkId` 切换扬声器（浏览器兼容）。
- 本地持久化：localStorage 保存服务器、房间、昵称、主题、麦克风/扬声器选择、token、用户信息。

### 3.3 Windows 客户端

- .NET 8 WPF，目标运行时 `win-x64`，输出程序集名为 `EchoLink`。
- 使用 WebSocketSharp 做 WebSocket 信令，UdpClient 直接收发 RTP。
- 音频捕获/播放：NAudio `WaveInEvent` / `WaveOutEvent`。
- 编解码：Concentus OpusEncoder / OpusDecoder。
- 降噪：
  - RNNoise（P/Invoke `librnnoise.dll`）
  - WebRTC APM（P/Invoke `webrtc-apm.dll`，来自 `SoundFlow.Extensions.WebRtc.Apm` 运行时）
  - 噪声门限（纯软件 VAD）
- 抖动缓冲与多用户混音：`Audio/AdaptiveJitterBuffer.cs`。
- 设置持久化到 `%APPDATA%/EchoLink/settings.json`。

### 3.4 音频参数（固定）

| 参数 | 值 |
|---|---|
| 采样率 | 48,000 Hz |
| 位深 | 16-bit PCM |
| Opus 通道数 | 2（发送端必须双声道，Windows 客户端播放端强制单声道） |
| 帧大小 | 960 采样点 = 20 ms |
| 编码码率 | 64 kbps |
| FEC | 开启（`useinbandfec=1`） |
| RTP PayloadType | 111（`0x6F`） |

---

## 4. 核心信令流程

### 4.1 通用顺序

客户端与服务器必须按以下顺序交互。已登录客户端可在 `joinRoom` 之前先发送 `authenticate`：

```
[可选] authenticate → authenticated
joinRoom → joinedRoom
→ createTransport → transportCreated → connectTransport → transportConnected
→ produce → produced                         （开麦发送音频）
→ createTransport → transportCreated → connectTransport
→ consume → consumed → resumeConsuming       （收听他人音频）
```

**关键约束**：Transport 必须 `create → connect` 之后才能 `produce/consume`；跳过 `connectTransport` 会静默失败。认证为可选，未认证客户端仍可使用原有匿名流程。

### 4.2 Web 客户端详细流程

1. 访问 `/` 进入房间一览页，可选择登录/注册或直接匿名进入房间。
2. WebSocket 连接。
3. 如有 token，先发送 `authenticate { token }` → 等待 `authenticated`。
4. `joinRoom { roomId, peerId }` → 服务器返回 `joinedRoom { rtpCapabilities, existingPeers, existingProducers }`。
5. 用 `rtpCapabilities` 初始化 `mediasoup-client Device`。
6. 创建 send Transport、connect、produce。
7. 创建 recv Transport、connect。
8. 对已有/新 Producer 执行 `consume → resumeConsuming`。
9. 广播消息：`newProducer`、`producerClosed`、`peerJoined`、`peerLeft`。

### 4.3 Windows 客户端详细流程

1. 登录窗口输入服务器地址，可选输入用户名/密码登录或注册。
2. 点击"进入房间列表"打开房间列表窗口，展示当前在线房间。
3. 选择房间或输入房间号后进入主窗口，建立 WebSocket 连接。
4. 如有 token，先发送 `authenticate { token }` → 等待 `authenticated`。
5. `joinRoom { roomId, peerId }` → 等待 `joinedRoom`。
6. `createPlainTransport { direction: "send" }` → 等待 `plainTransportCreated { id, ip, port }`。
7. `createPlainTransport { direction: "recv" }` → 等待 `plainTransportCreated`。
8. 向 recv 端点发送一个空 RTP 包触发 mediasoup `comedia` 自动检测远端地址。
9. 启动 RTP 接收循环。
10. 开麦时 `produce { kind: "audio", rtpParameters }` → 等待 `produced`。
11. 收到 `newProducer` 时 `consume { producerId, rtpCapabilities }` → 等待 `consumed` → `resumeConsuming { consumerId }`。

### 4.4 服务端消息类型

| 消息 | 方向 | 说明 |
|---|---|---|
| `joinRoom` | C→S | 加入房间 |
| `joinedRoom` | S→C | 返回 RTP 能力、现有 Peer/Producer 列表 |
| `createTransport` | C→S | 创建 WebRtcTransport（send/recv） |
| `transportCreated` | S→C | 返回 ICE/DTLS 参数 |
| `connectTransport` | C→S | 完成 DTLS 握手 |
| `transportConnected` | S→C | 确认连接 |
| `produce` | C→S | 创建 Producer |
| `produced` | S→C | 返回 producerId |
| `newProducer` | S→广播 | 通知新 Producer |
| `producerClosed` | S→广播 | Producer 关闭 |
| `consume` | C→S | 创建 Consumer |
| `consumed` | S→C | 返回 consumerId + rtpParameters |
| `resumeConsuming` | C→S | 恢复 Consumer |
| `consumerResumed` | S→C | 确认恢复 |
| `createPlainTransport` | C→S | 创建 PlainTransport（Windows 客户端） |
| `plainTransportCreated` | S→C | 返回 IP + 端口 |
| `closeProducer` | C→S | 主动关闭 Producer |
| `leaveRoom` | C→S | 离开房间 |
| `peerJoined` / `peerLeft` | S→广播 | Peer 进出通知 |
| `authenticate` | C→S | WebSocket 认证（可选） |
| `authenticated` | S→C | 认证成功 |
| `authError` | S→C | 认证失败 |
| `listRooms` | C→S | 请求当前在线房间列表 |
| `roomsList` | S→C | 返回在线房间列表 |
| `error` | S→C | 错误信息 |

### 4.5 HTTP REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/rooms` | 当前在线房间列表（认证可选） |
| GET | `/health` | 健康检查 |

---

## 5. 构建与运行命令

### 5.1 Server

```bash
cd server
npm install
npm run dev          # ts-node 开发模式，默认监听 1985 端口
npm run build        # TypeScript 编译到 dist/
npm start            # 运行 dist/index.js
```

健康检查：

```bash
curl http://localhost:1985/health
```

返回示例：

```json
{ "status": "ok", "workers": 8, "rooms": 1, "workerPids": [ ... ] }
```

### 5.2 Web Client

```bash
cd web
npm install
npm run dev          # Vite 开发服务器，默认 http://localhost:5173
npm run build        # tsc + vite build → dist/
npm run lint         # ESLint
npm test             # vitest run（jsdom 环境）
npm run test:watch   # vitest watch 模式
npm run preview      # 预览生产构建
```

### 5.3 Windows Client

```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
```

发布单文件：

```bash
# 使用脚本（Release、SelfContained、PublishSingleFile、ReadyToRun）
.\publish.ps1

# 或手动
dotnet publish VoiceChat -c Release --self-contained true
```

输出目录：`windows/VoiceChat/bin/Release/net8.0-windows/win-x64/publish/EchoLink.exe`。

### 5.4 Docker 部署

```bash
# 项目根目录
docker-compose up -d
```

`docker-compose.yml` 会构建并启动：

- `server`：WebSocket + mediasoup UDP 端口。
- `web`：Nginx 托管静态文件，映射 `80:80`。

---

## 6. 端口与环境变量

### 6.1 端口对照

| 场景 | 端口 | 来源 |
|---|---|---|
| Server 直接运行（dev/build） | **1985** | `server/src/config.ts` 默认值 |
| Server Docker 部署 | **3000** | `docker-compose.yml` 覆盖 |
| Web Vite 开发服务器 | **5173** | Vite 默认 |
| Web Vite WebSocket 代理目标 | **1985** | `web/vite.config.ts` proxy 配置 |
| Web 生产 Nginx WebSocket 代理目标 | **3000** | `web/nginx.conf` proxy_pass 到 `server:3000` |
| mediasoup UDP | **10000-10100**（可配置） | `.env.example` / `docker-compose.yml` |

注意：

- `server/src/config.ts` 中 `RTC_MIN_PORT` / `RTC_MAX_PORT` 的默认值为 `10000` / `59999`。
- `.env.example` 和 `docker-compose.yml` 中通常覆盖为 `10000-10100`。
- `CLAUDE.md` 和 `server/README.md` 中写的 `ws://localhost:3000` 是 Docker 场景；直接 `npm run dev` 跑 server 时端口是 **1985**。

### 6.2 环境变量

根目录 `.env.example` 模板：

```bash
ANNOUNCED_IP=127.0.0.1      # 必填，服务器公网 IP，本地开发用 127.0.0.1
LISTEN_PORT=3000            # 默认 3000，dev 模式为 1985
RTC_MIN_PORT=10000          # WebRTC UDP 端口范围起始
RTC_MAX_PORT=10100          # WebRTC UDP 端口范围结束
JWT_SECRET=change-me-in-production  # JWT 密钥，生产环境必须修改
JWT_EXPIRES_IN=7d           # JWT token 有效期
DATABASE_PATH=./echolink.db # SQLite 数据库文件路径
```

服务端 `config.ts` / `auth.ts` / `db.ts` 读取：

- `ANNOUNCED_IP` → WebRTC `announcedIp`。
- `LISTEN_PORT` → HTTP + WebSocket 监听端口。
- `RTC_MIN_PORT` / `RTC_MAX_PORT` → mediasoup Worker 媒体端口范围。
- `JWT_SECRET` / `JWT_EXPIRES_IN` → JWT 签发与校验。
- `DATABASE_PATH` → SQLite 文件路径。

Web 客户端连接地址：

- HTTPS 环境：`wss://${window.location.host}/ws`（走 Nginx 代理）。
- 否则根据输入自动探测 `1985, 3000, 8080, 8000, 5000, 4000`。

---

## 7. 代码组织主要模块

### 7.1 服务端模块

| 文件 | 职责 |
|---|---|
| `index.ts` | 入口：创建 Worker 池、HTTP 服务器（含 REST API）、WebSocket 服务器、全局房间状态、优雅关闭。 |
| `config.ts` | 集中读取环境变量，定义 mediasoup Worker、Router、WebRtcTransport 配置。 |
| `mediasoupWorker.ts` | Worker 池创建（按 CPU 核心数）、round-robin 取 Worker、资源统计、Router 工厂。 |
| `room.ts` | Room 类：创建 Router、管理 Peers、创建 WebRtcTransport / PlainTransport、清理资源。 |
| `peer.ts` | Peer 接口：sendTransport、recvTransport、producers Map、consumers Map。 |
| `signaling.ts` | WebSocket 消息分发与业务逻辑：authenticate、join、transport、produce、consume、resume、leave 等。 |
| `db.ts` | SQLite 数据库层：用户表创建与查询。 |
| `auth.ts` | JWT 认证：注册、登录、token 校验。

### 7.2 Web 客户端模块

| 文件 | 职责 |
|---|---|
| `useMediasoup.ts` | 核心 Hook：WebSocket 连接、信令请求-响应匹配、Transport 创建、Producer/Consumer 生命周期、音频处理、设备枚举、VAD、延迟检测。 |
| `useAuth.ts` | 账号状态管理：登录、注册、token 持久化、用户信息恢复。 |
| `Room.tsx` | Discord 风格房间页 UI。 |
| `RoomList.tsx` | 房间一览页：展示在线房间、创建/进入房间、登录/注册入口。 |
| `Login.tsx` / `Register.tsx` | 登录/注册页面。 |
| `useTheme.ts` / `themes.ts` | 5 套主题（dark / light / purple / ocean / sunset）+ CSS 变量注入。 |
| `types.ts` | 与 server 对齐的 SignalingMessage 联合类型。 |
| `App.tsx` / `main.tsx` | 路由（`/`、`/login`、`/register`、`/room/:roomId`）与 React 应用入口。 |

### 7.3 Windows 客户端模块

| 文件 | 职责 |
|---|---|
| `LoginWindow.xaml.cs` | 连接入口：读取/保存设置、端口探测（默认探测 1985）、构造 WebSocket URL、主题切换、账号登录/注册、打开房间列表窗口。 |
| `RoomsWindow.xaml.cs` | 房间列表窗口：调用 `/api/rooms` 展示在线房间、支持创建/进入房间。 |
| `AuthService.cs` | HTTP 客户端封装：登录、注册、获取房间列表、token 管理。 |
| `MainWindow.xaml.cs` | 核心逻辑：WebSocket 信令（含可选 authenticate）、PlainTransport RTP 收发、Opus 编解码、NAudio 音频、VAD、UI 更新。 |
| `Audio/AdaptiveJitterBuffer.cs` | 多用户抖动缓冲、丢包补偿（PLC）、按 SSRC 的独立解码与混音、主音量 / 单 Peer 音量控制。 |
| `Audio/RnnoiseDenoiser.cs` | RNNoise P/Invoke 封装 + 语音概率动态增益。 |
| `Audio/WebRtcNoiseSuppressor.cs` | WebRTC APM P/Invoke 封装（NS + AGC + HPF + Pre-Amp）。 |
| `VoiceChat.csproj` | 项目引用与发布配置（`PublishSingleFile`、`SelfContained`、`PublishReadyToRun`）。 |

---

## 8. 测试策略

### 8.1 服务端

- 目前**无自动化单元测试**。
- 提供 `test-signaling.js` 作为简单的 WebSocket 信令测试脚本。
- 验证方式：启动 server 后用 `curl http://localhost:1985/health` 检查健康状态，或用 WebSocket 客户端手动发送 `joinRoom`。

### 8.2 Web 客户端

- 测试框架：**Vitest + jsdom + @testing-library/react**。
- 测试文件：
  - `src/themes.test.ts`：主题数量、默认主题、颜色字段校验。
  - `src/types.test.ts`：信令消息类型形状校验。
  - `src/components/Room.test.tsx`：房间页加载状态渲染。
- 运行：

```bash
cd web
npm test
npm run test:watch
```

### 8.3 Windows 客户端

- 目前**无自动化单元测试**。
- 验证方式：本地运行 `dotnet run --project VoiceChat`，加入同一房间后测试双向语音。

---

## 9. 代码风格与开发约定

### 9.1 TypeScript / JavaScript

- 服务端使用 `tsconfig.json`：`target: ES2022`、`module: commonjs`、`strict: true`。
- Web 端使用 `tsconfig.app.json`：`target: es2023`、`module: esnext`、`jsx: react-jsx`。
- Web ESLint 配置：`eslint.config.js` 使用 `@eslint/js` + `typescript-eslint` + `react-hooks` + `react-refresh`。
- Web 构建前必须通过 `npm run lint` 与 `tsc -b`。
- 服务端大量使用 `console.log` / `console.error` 做日志，暂无结构化日志库。

### 9.2 C# / WPF

- 目标框架 `net8.0-windows`，启用 `Nullable` 与 `ImplicitUsings`。
- 项目使用文件作用域命名空间与顶层语句风格不冲突；当前代码仍使用传统命名空间声明。
- UI 主要用代码动态创建成员卡片，部分样式内联在 `MainWindow.xaml` 资源字典中。

### 9.3 通用约定

- **禁止替换技术栈**：不得引入 LiveKit、Janus、Agora、Electron 等。固定选型为 mediasoup + ws + NAudio + Concentus。
- **mediasoup API 必须遵循官方文档**：不确定时查阅 https://mediasoup.org/documentation/，禁止猜测方法名或参数。
- **实现 transport/producer/consumer 前先写注释描述完整协商流程**。
- **禁止在客户端硬编码密钥或凭证**，应使用环境变量或 `config.ts`。
- **聚焦当前步骤**，不要提前生成未来步骤的代码。
- Windows 客户端 RTP PayloadType 硬编码为 `111`（`0x6F`），与 mediasoup 默认一致。

---

## 10. 安全与部署注意事项

### 10.1 安全

- `.env` 文件被标记为敏感文件，不应提交到版本控制。仓库中只提供 `.env.example` 模板。
- 所有配置（端口、公网 IP、媒体端口范围、JWT 密钥、数据库路径）都通过环境变量注入，服务端 `config.ts` 读取，不在代码中硬编码。
- 用户密码使用 `bcrypt` 哈希后存入 SQLite，严禁明文存储。
- `JWT_SECRET` 必须设置为强随机字符串并妥善保管，禁止硬编码在源码中。
- Windows 客户端设置保存到 `%APPDATA%/EchoLink/settings.json`（服务器地址、房间、昵称、主题、token、用户信息），不含密码。
- Web 客户端 localStorage 键：
  - `echolink-server`
  - `echolink-room`
  - `echolink-peer`
  - `echolink-mic`
  - `echolink-speaker`
  - `echolink-theme`
  - `echolink-auth`
- Windows 客户端 RNNoise DLL `librnnoise.dll` 仅在文件存在时复制到输出目录；WebRTC APM DLL 由 NuGet 包 `SoundFlow.Extensions.WebRtc.Apm` 在运行时提供。

### 10.2 部署

- **Docker**：根目录 `docker-compose up -d` 部署 server + web。`docker-compose.yml` 已将 `./data` 挂载到 server 容器的 `/data`，用于持久化 SQLite 数据库。
- **Windows 安装包**：运行 `windows/publish.ps1` 生成自包含单文件 `EchoLink.exe`，再用 `windows/installer.nsi` 生成 `EchoLink-Setup-1.0.0.exe`。
- **端口放行**：部署时需放行 `LISTEN_PORT` 与 `RTC_MIN_PORT-RTC_MAX_PORT/udp`。
- **ANNOUNCED_IP**：本地开发用 `127.0.0.1`；公网部署必须改为服务器公网 IP，否则 WebRTC ICE 候选地址错误。
- **JWT_SECRET**：Docker 部署时通过 `.env` 设置，请勿使用默认值。

---

## 11. 已知关键约束（不要违反）

- 两种客户端不能互相替换传输方式：Web 必须用 `WebRtcTransport`，Windows 必须用 `PlainTransport`。
- Windows 客户端音频链路：
  - 麦克风输入为 **单声道 48 kHz 16-bit**。
  - 编码前复制为 **双声道** 以满足 mediasoup Opus 2 通道要求。
  - 解码后**只取左声道**播放，因此播放端为单声道。
- Web 端 Consumer 初始为 `paused` 状态，必须通过 `resumeConsuming` 恢复。
- 服务端一个 Peer 同时只能有 **1 个 sendTransport 和 1 个 recvTransport**。
- `config.ts` 的 `mediaCodecs` 使用了 `as unknown as mediasoupTypes.RtpCodecCapability[]` 类型断言；修改时注意保持类型兼容。
- 服务端全局状态 `rooms` / `roomClients` 目前定义在 `index.ts` 并通过参数传递到 `signaling.ts`。

---

*本文件应当根据代码变更同步更新。修改 `server/`、`web/`、`windows/` 的关键配置、信令协议、音频参数、构建脚本时，请同时更新此文档。*
