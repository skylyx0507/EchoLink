# EchoLink Server 架构文档

> 本文档基于源码分析生成，供后续 AI 或开发者快速理解项目结构。
> 生成时间：2025-06-06

---

## 1. 项目概述

EchoLink Server 是一个基于 **Node.js + TypeScript + mediasoup + WebSocket** 的 **SFU（Selective Forwarding Unit）语音聊天服务器**。

- 支持浏览器客户端（WebRTC）和非浏览器客户端（PlainTransport / RTP）
- 每个房间（Room）拥有独立的 mediasoup Router
- 当前为单进程、单 Worker 架构（仅利用 1 个 CPU 核心）
- 信令通过原生 WebSocket 传输 JSON 消息

---

## 2. 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18 | 运行时 |
| TypeScript | 5.7 | 开发语言 |
| mediasoup | 3.20.0 | SFU 媒体转发引擎（C++ 子进程） |
| ws | 8.18.0 | WebSocket 服务器 |
| ts-node | 10.9 | 开发热重载 |

---

## 3. 目录结构

```
server/
├── src/
│   ├── index.ts              # 入口：组装 HTTP + WebSocket + mediasoup Worker
│   ├── config.ts             # 配置：端口、Worker 参数、媒体编解码器、WebRTC 传输参数
│   ├── mediasoupWorker.ts    # mediasoup Worker 创建 + Router 创建
│   ├── signaling.ts          # WebSocket 信令处理（核心逻辑，~400 行）
│   ├── room.ts               # Room 类：管理 Router + Peer 集合 + Transport 创建
│   └── peer.ts               # Peer 接口：sendTransport / recvTransport / producers / consumers
├── dist/                     # tsc 编译输出（CommonJS）
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 4. 核心模块详解

### 4.1 `index.ts` — 入口与全局状态

**职责**：启动 HTTP 服务器、WebSocket 服务器、mediasoup Worker，管理全局房间状态。

**全局状态**（当前耦合在入口文件中）：
```typescript
const rooms = new Map<string, Room>();          // roomId → Room
const roomClients = new Map<string, Set<WebSocket>>();  // roomId → WebSocket 集合
```

**启动顺序**：
1. `createWorker()` — 创建 mediasoup Worker（C++ 子进程）
2. `http.createServer()` — HTTP 服务器（仅提供 `/health` 健康检查）
3. `new WebSocketServer({ server: httpServer })` — WebSocket 复用 HTTP 端口
4. `handleSignaling(ws, rooms, roomClients, worker)` — 每个连接进入信令处理

**注意**：当前仅创建 **1 个 Worker**，所有 Room 共享该 Worker 上的不同 Router。

---

### 4.2 `config.ts` — 配置中心

**关键配置项**：

| 配置 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 监听端口 | `LISTEN_PORT` | `1985` | HTTP + WebSocket 端口 |
| 公网 IP | `ANNOUNCED_IP` | `127.0.0.1` | WebRTC ICE 候选地址 |
| RTC 端口范围 | `RTC_MIN_PORT` / `RTC_MAX_PORT` | 10000 ~ 10100 | mediasoup UDP/TCP 端口 |
| 日志级别 | — | `warn` | mediasoup Worker 日志 |

**媒体编解码器**：仅配置 **Opus 音频**（48kHz, 2 通道, inband FEC），无视频。

**类型安全注意**：`mediaCodecs` 使用了 `as unknown as mediasoupTypes.RtpCodecCapability[]` 类型断言。

---

### 4.3 `mediasoupWorker.ts` — Worker 与 Router 工厂

**导出函数**：
- `createWorker(): Promise<Worker>` — 创建 mediasoup Worker，监听 `died` 事件（2 秒后退出进程）
- `createRouter(worker): Promise<Router>` — 在指定 Worker 上创建 Router，绑定 `config.mediaCodecs`

**注意**：Worker 实例被保存在模块级变量 `let worker` 中，但并未被外部直接引用（外部通过返回值传递）。

---

### 4.4 `room.ts` — 房间管理

**类**：`Room`

| 成员 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 房间标识 |
| `router` | `mediasoup.Router` | 每个房间独立的 Router |
| `peers` | `Map<string, Peer>` | 房间内所有 Peer |

**关键方法**：
- `static async create(id, worker)` — 工厂方法，创建 Room 并初始化 Router
- `addPeer(peerId)` / `removePeer(peerId)` — Peer 生命周期管理
- `getOtherProducers(peerId)` — 获取房间内其他 Peer 的所有 Producer（用于新加入者拉流）
- `createWebRtcTransport()` — 创建 WebRtcTransport（浏览器客户端）
- `createPlainTransport()` — 创建 PlainTransport（RTP 直连，用于 C# 等非浏览器客户端）

**`removePeer` 清理逻辑**：关闭所有 Producer → Consumer → Transport，然后从 Map 删除。

---

### 4.5 `peer.ts` — Peer 数据结构

**接口**：`Peer`

```typescript
interface Peer {
  id: string;
  sendTransport: WebRtcTransport | PlainTransport | null;
  recvTransport: WebRtcTransport | PlainTransport | null;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}
```

**注意**：当前一个 Peer 同时只能拥有 **1 个 sendTransport 和 1 个 recvTransport**（不支持多路传输）。

---

### 4.6 `signaling.ts` — 信令处理（最复杂模块）

**函数**：`handleSignaling(ws, rooms, roomClients, worker)`

**闭包状态**（每个 WebSocket 连接独立）：
- `currentPeerId: string | null`
- `currentRoom: Room | null`

**消息分发**：通过 `switch (msg.type)` 路由到对应 handler。

---

## 5. 信令协议（WebSocket JSON）

### 5.1 完整交互流程

```
Client                                                          Server
  |                                                               |
  |── joinRoom { roomId, peerId }───────────────────────────────>>|
  |<<────────────────────────── joinedRoom { rtpCapabilities, ... }─|
  |                                                               |
  |── createTransport { direction: "send" }───────────────────────>>|
  |<<──────────────────────────── transportCreated { id, ice, ... }|
  |── connectTransport { transportId, dtlsParameters }────────────>>|
  |<<────────────────────────────── transportConnected────────────|
  |                                                               |
  |── produce { kind, rtpParameters }─────────────────────────────>>|
  |<<────────────────────────────────── produced { producerId }─────|
  |                    <<广播>> newProducer { producerId, peerId }|
  |                                                               |
  |── createTransport { direction: "recv" }───────────────────────>>|
  |── connectTransport { transportId, dtlsParameters }────────────>>|
  |── consume { producerId, rtpCapabilities }───────────────────>>|
  |<<──────────────── consumed { consumerId, producerId, rtpParams }|
  |── resumeConsuming { consumerId }────────────────────────────>>|
  |<<────────────────────────────── consumerResumed───────────────|
  |                                                               |
  |── leaveRoom─────────────────────────────────────────────────>>|
  |                    <<广播>> peerLeft { peerId }                |
```

### 5.2 消息类型汇总

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `joinRoom` | C→S | 加入房间，需提供 `roomId` + `peerId` |
| `joinedRoom` | S→C | 返回 Router 的 `rtpCapabilities` + 现有 Peer/Producer 列表 |
| `createTransport` | C→S | 创建 send/recv WebRtcTransport |
| `transportCreated` | S→C | 返回 `id`, `iceParameters`, `iceCandidates`, `dtlsParameters` |
| `connectTransport` | C→S | 传入 `dtlsParameters` 完成 DTLS 握手 |
| `transportConnected` | S→C | 确认连接 |
| `produce` | C→S | 在 sendTransport 上创建 Producer |
| `produced` | S→C | 返回 `producerId` |
| `newProducer` | S→广播 | 通知房间内其他 Peer 有新 Producer |
| `consume` | C→S | 在 recvTransport 上创建 Consumer（初始 paused） |
| `consumed` | S→C | 返回 `consumerId` + `rtpParameters` |
| `resumeConsuming` | C→S | 客户端准备好后恢复 Consumer |
| `consumerResumed` | S→C | 确认恢复 |
| `leaveRoom` | C→S | 主动离开房间 |
| `peerJoined` / `peerLeft` | S→广播 | Peer 进出通知 |
| `producerClosed` | S→广播 | Producer 关闭通知 |
| `consumerClosed` | S→C | Consumer 关闭通知 |
| `createPlainTransport` | C→S | 创建 PlainTransport（非浏览器客户端） |
| `plainTransportCreated` | S→C | 返回 `ip`, `port`, `rtcpPort` |

---

## 6. 数据流与关键时序

### 6.1 新 Peer 加入房间

1. `handleJoinRoom`
   - 若 `rooms` 中不存在该 `roomId`，调用 `Room.create()` 新建 Room + Router
   - `room.addPeer(peerId)` 创建 Peer 对象
   - 将 `ws` 加入 `roomClients[roomId]`
   - 收集现有 Producer（通过 `room.getOtherProducers()`）
   - 发送 `joinedRoom` + 广播 `peerJoined`

2. 客户端收到 `joinedRoom` 后：
   - 为每个现有 Producer 执行 `consume` → `resumeConsuming`

### 6.2 Producer 创建与广播

1. `handleProduce`
   - 在 `peer.sendTransport` 上调用 `.produce()`
   - 将 Producer 存入 `peer.producers`
   - 监听 `transportclose` 事件自动清理
   - 发送 `produced` 给当前 Peer
   - **广播 `newProducer` 给房间内其他 Peer**

### 6.3 连接断开清理

1. `ws.on("close")` → `handleLeaveRoom()`
   - `room.removePeer(peerId)` — 关闭所有 Producer/Consumer/Transport
   - 从 `roomClients[roomId]` 删除 `ws`
   - 广播 `peerLeft`
   - 若房间为空，`rooms.delete(roomId)` 销毁房间

---

## 7. 已知架构问题（技术债）

> 以下问题在后续迭代中需要关注：

| 优先级 | 问题 | 影响 | 建议方向 |
|--------|------|------|----------|
| 🔴 高 | **单 Worker 瓶颈** | 仅利用 1 个 CPU 核心，无法水平扩展 | 实现 Worker 池 + 按负载分配 Room |
| 🟡 中 | **全局状态耦合** | `rooms` / `roomClients` 定义在 `index.ts`，通过参数层层传递 | 提取 `RoomManager` 服务层 |
| 🟡 中 | **signaling.ts 过于庞大** | ~400 行，所有 handler 挤在一个闭包，难以单元测试 | 拆分为独立 Handler 类 + 依赖注入 |
| 🟡 中 | **类型安全薄弱** | 多处 `as any` / `as unknown` 断言；`SignalingMessage` 字段全可选 | 引入 zod 做运行时校验 + 精确联合类型 |
| 🟡 中 | **内存泄漏风险** | `roomClients` 存储 WebSocket 实例，异常断开时可能残留 | 增加反向映射 + 定期清理死连接 |
| 🟡 中 | **缺乏结构化日志** | 使用 `console.log`，无日志级别和请求追踪 | 引入 pino / winston |
| 🟡 中 | **配置无校验** | 环境变量直接 `parseInt`，无效值会导致 `NaN` | 启动时校验配置，失败立即退出 |
| 🟠 低 | **健康检查太浅** | `/health` 不检查 Worker 存活状态 | 增加 Worker 心跳 + 返回连接数/房间数 |
| 🟠 低 | **优雅关闭不完整** | `SIGINT` 直接 `process.exit(0)`，未等待资源清理 | 使用 `httpServer.close()` + 超时兜底 |
| 🟢 低 | **Peer 仅支持单 Transport** | 无法同时支持 WebRTC + PlainTransport | 考虑拆分 Peer 类型或支持多 Transport |

---

## 8. 部署与运行

### 8.1 开发模式

```bash
cd server
npm install
npm run dev        # ts-node src/index.ts
```

### 8.2 生产模式

```bash
npm run build      # tsc → dist/
npm start          # node dist/index.js
```

### 8.3 Docker

```bash
docker-compose up  # 使用 docker-compose.yml 中的配置
```

**关键环境变量**：
- `ANNOUNCED_IP` — 服务器公网 IP（WebRTC 必需）
- `LISTEN_PORT` — 监听端口（默认 1985）
- `RTC_MIN_PORT` / `RTC_MAX_PORT` — mediasoup 媒体端口范围

---

## 9. 扩展方向

- **多 Worker 架构**：按 CPU 核心数创建 Worker 池，Room 分配到不同 Worker
- **REST API**：在 HTTP 服务器上增加房间管理、统计查询接口
- **认证层**：WebSocket 连接时增加 Token 校验
- **监控**：暴露 Prometheus 指标（房间数、Peer 数、Producer/Consumer 数、Worker CPU）
- **录制**：利用 mediasoup 的 `PlainTransport` + FFmpeg/GStreamer 实现服务端录制

---

*文档结束。如需修改，请同步更新本文件。*
