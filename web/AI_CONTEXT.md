# EchoLink Web 客户端 — AI 理解文档

> 本文档基于源码分析生成，供后续 AI 或开发者快速理解 `web/` 目录下的项目。
> 生成时间：2025-06-06
> 关联项目：EchoLink（实时游戏语音通话系统）

---

## 1. 项目概述

EchoLink Web 客户端是 EchoLink 语音聊天系统的 **浏览器端验证客户端**，基于 **React 19 + TypeScript + Vite** 构建，使用 **mediasoup-client** 与服务器进行 WebRTC 音视频通信。

**定位**：
- 不是生产级主客户端（主客户端是 Windows C# WPF）
- 用于验证 mediasoup SFU 服务器的功能正确性
- 支持多用户房间、麦克风开关、成员列表、语音活动检测（VAD）、降噪、主题切换

---

## 2. 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| React | 19.2.6 | UI 框架 |
| TypeScript | ~6.0.2 | 开发语言 |
| Vite | 8.0.12 | 构建工具 + 开发服务器 |
| mediasoup-client | 3.20.0 | WebRTC SFU 客户端库 |
| @jitsi/rnnoise-wasm | 0.2.1 | WASM 降噪处理器（二次降噪） |
| ESLint | 10.3.0 | 代码检查 |

---

## 3. 目录结构

```
web/
├── src/
│   ├── components/
│   │   ├── Room.tsx           # 主界面组件：登录页 + 房间页（Discord 风格）
│   │   └── ThemeSwitcher.tsx  # 主题切换下拉按钮
│   ├── hooks/
│   │   ├── useMediasoup.ts    # 核心：mediasoup 信令 + WebRTC + 音频处理 Hook
│   │   └── useTheme.ts        # 主题管理 Hook（CSS 变量注入）
│   ├── themes.ts              # 5 套主题配置（dark/light/purple/ocean/sunset）
│   ├── types.ts               # 信令消息类型定义（与 server 协议对齐）
│   ├── App.tsx                # 根组件，仅渲染 <Room />
│   ├── main.tsx               # React 应用入口（StrictMode）
│   ├── App.css                # 全部样式（~1100 行，无 CSS 框架）
│   └── index.css              # 全局重置样式
├── public/
│   ├── enhanced-noise-suppressor.js  # AudioWorklet 降噪处理器
│   ├── rnnoise-processor.js          # RNNoise 处理器（备用）
│   ├── rnnoise.wasm                  # RNNoise WASM 模块
│   └── favicon.svg / icons.svg       # 静态资源
├── dist/                      # Vite 构建输出（生产包）
├── index.html                   # HTML 入口
├── vite.config.ts             # Vite 配置（含 WebSocket 代理）
├── package.json
├── tsconfig*.json
├── Dockerfile                 # 多阶段构建：Node → Nginx
└── nginx.conf                 # Nginx SPA 配置 + WebSocket 代理
```

---

## 4. 核心模块详解

### 4.1 `useMediasoup.ts` — 核心 Hook（~770 行）

**职责**：封装完整的 mediasoup-client 信令流程 + 音频处理 + 设备管理。

**核心状态**：
```typescript
roomState: RoomState      // 房间信息、Peer 列表、麦克风状态
isSpeaking: boolean       // 当前是否正在说话（VAD）
noiseLevel: NoiseLevel    // 降噪档位（off/low/medium/high）
latency: number          // RTT 延迟（毫秒）
micDevices / speakerDevices  // 音频设备列表
selectedMic / selectedSpeaker // 当前选中设备（持久化到 localStorage）
```

**内部 Refs**（不触发重渲染的关键对象）：
```typescript
wsRef              // WebSocket 连接
deviceRef          // mediasoup Device（加载 Router RTP 能力后创建）
sendTransportRef   // 发送 Transport（用于 produce）
recvTransportRef   // 接收 Transport（用于 consume）
producerRef        // 当前用户的音频 Producer
consumersRef       // 其他用户的 Consumer 映射
peersRef           // Peer 信息映射（含 audioElement）
audioContextRef    // Web Audio API Context（用于音量检测/降噪）
noiseSuppressorRef // AudioWorkletNode（二次降噪）
rawStreamRef       // 原始麦克风 MediaStream
```

**关键方法**：

| 方法 | 说明 |
|------|------|
| `joinRoom(serverUrl, roomId, peerId)` | 完整入房流程：WS 连接 → joinRoom → 等待 joinedRoom → 加载 Device → 创建 send/recv Transport → 消费已有 Producers |
| `leaveRoom()` | 清理所有资源：关闭 consumers/producer/transports/WS/audio elements |
| `enableMic()` | 获取麦克风 → 可选 AudioWorklet 降噪 → produce 到 sendTransport |
| `disableMic()` | 关闭 producer + 清理降噪资源 + 停止音量检测 |
| `consumeRemote(producerId, peerId)` | 在 recvTransport 上 consume，创建 Audio 元素播放 |
| `enumerateAudioDevices()` | 枚举麦克风/扬声器，恢复上次选择 |

**信令消息路由**：
- 使用 `messageHandlersRef` Map 实现 **请求-响应匹配**（如发送 `createTransport` 后等待 `transportCreated`）
- `waitForMessage(type, timeout)` 返回 Promise，超时 15 秒
- 广播消息（`newProducer`, `peerJoined`, `peerLeft`, `producerClosed`）通过 `ws.onmessage` 直接处理

**降噪实现**：
- 浏览器原生：`echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`
- 二次降噪（可选）：通过 `AudioWorklet` 加载 `/enhanced-noise-suppressor.js`，支持 4 档降噪强度
- 降噪档位配置 `NOISE_PRESETS`：off / low / medium / high（不同 gateThreshold / vadThreshold）

**音量检测**：
- 使用 `AnalyserNode` + `requestAnimationFrame` 实时检测音量
- 当 noiseLevel !== "off" 时，通过 AudioWorklet 的 VAD 消息驱动 `isSpeaking`

**延迟检测**：
- 每 2 秒通过 `producer.getStats()` 获取 RTT
- 显示在底部控制栏（<50ms 绿色，<100ms 黄色，>100ms 红色）

---

### 4.2 `Room.tsx` — UI 组件（~420 行）

**双界面模式**：

#### 登录界面（未加入房间时）
- 服务器地址输入（支持自动端口嗅探）
- 房间号输入
- 昵称输入（默认随机生成）
- 输入持久化到 `localStorage`

**端口嗅探**：`probePort(host)` 尝试连接 `PROBE_PORTS = [1985, 3000, 8080, 8000, 5000, 4000]`，自动找到可用 WebSocket 端口。

#### 房间界面（Discord 风格语音频道）
- **频道头部**：房间名、降噪控制按钮组、断开连接按钮
- **成员网格**：自己（带头像 + 说话光环 + 波形指示器）+ 其他成员（头像 + 麦克风状态点）
- **底部控制栏**：
  - 左侧：用户头像 + 昵称 + 状态（说话中/麦克风已开/已关）
  - 中间：麦克风开关大按钮 + 设备设置按钮（弹出麦克风/扬声器选择菜单）
  - 右侧：延迟显示 + 在线人数

---

### 4.3 `useTheme.ts` — 主题 Hook

- 5 套主题：`dark`（默认）/ `light` / `purple` / `ocean` / `sunset`
- 通过 CSS 变量注入到 `:root`（`--primary`, `--bg`, `--text` 等 16 个变量）
- 持久化到 `localStorage`（key: `echolink-theme`）

---

### 4.4 `themes.ts` — 主题配置

每套主题定义 16 个颜色变量，涵盖：
- 主色 / 悬停色 / 浅色背景
- 成功色 / 危险色
- 背景色（页面/卡片/输入框）
- 文字色（主/次/弱化）
- 边框色 / 渐变背景

---

### 4.5 `types.ts` — 信令类型

与 server 的 `signaling.ts` 严格对齐的 TypeScript 接口：

```typescript
SignalingMessage = JoinRoomMessage | JoinedRoomMessage | CreateTransportMessage | ...
PeerInfo = { peerId, micEnabled?, audioConsumer?, audioElement? }
RoomState = { roomId, peerId, joined, micEnabled, peers: Map<string, PeerInfo> }
```

---

## 5. 与 Server 的交互协议

WebSocket 连接建立后，按以下顺序交互：

```
Client                                                          Server
  |                                                               |
  |── WebSocket connect ─────────────────────────────────────────>>|
  |── joinRoom { roomId, peerId }───────────────────────────────>>|
  |<<────────────────────────── joinedRoom { rtpCapabilities, ... }─|
  |                                                               |
  |── createTransport { direction: "send" }─────────────────────>>|
  |<<──────────────────────────── transportCreated { id, ice, ... }|
  |── connectTransport { transportId, dtlsParameters }──────────>>|
  |<<────────────────────────────── transportConnected────────────|
  |                                                               |
  |── produce { kind, rtpParameters }───────────────────────────>>|
  |<<────────────────────────────────── produced { producerId }───|
  |                    <<广播>> newProducer { producerId, peerId }|
  |                                                               |
  |── createTransport { direction: "recv" }─────────────────────>>|
  |── connectTransport { transportId, dtlsParameters }────────────>>|
  |── consume { producerId, rtpCapabilities }───────────────────>>|
  |<<──────────────── consumed { consumerId, producerId, rtpParams }|
  |── resumeConsuming { consumerId }────────────────────────────>>|
  |<<────────────────────────────── consumerResumed─────────────|
```

**关键约束**：
- Transport 必须先 `create` → `connect` → 才能 `produce`/`consume`
- Consumer 初始创建为 `paused` 状态，客户端准备好后发送 `resumeConsuming`
- 跳过 `connectTransport` 会导致静默失败

---

## 6. 关键实现细节

### 6.1 Vite 代理配置

```typescript
// vite.config.ts
server: {
  proxy: {
    "/ws": {
      target: "ws://localhost:1985",
      ws: true,
    },
  },
}
```

开发时 WebSocket 请求自动代理到本地服务器（默认 1985 端口）。

### 6.2 音频设备持久化

- 麦克风选择：`localStorage` key = `echolink-mic`
- 扬声器选择：`localStorage` key = `echolink-speaker`
- 服务器地址：`echolink-server`
- 房间号：`echolink-room`
- 昵称：`echolink-peer`

### 6.3 扬声器切换

使用 `HTMLAudioElement.setSinkId(deviceId)` API（非标准，Chrome/Edge 支持），切换时更新所有已有音频元素的输出设备。

### 6.4 自动播放策略处理

- 创建 Audio 元素时设置 `autoplay = true`
- 显式调用 `audioElement.play()`，捕获异常处理浏览器自动播放限制
- 监听 `track.onunmute` 再次尝试播放

### 6.5 资源清理

`leaveRoom()` / `disableMic()` / 组件卸载时清理：
- 关闭所有 Consumer / Producer / Transport
- 停止所有 MediaStreamTrack
- 移除所有 Audio 元素
- 关闭 WebSocket
- 取消动画帧 / 关闭 AudioContext
- 停止延迟检测定时器

---

## 7. 样式系统

**纯 CSS，无框架**（~1100 行 `App.css` + 少量 `index.css`）。

**设计特点**：
- CSS 变量驱动主题切换（16 个变量）
- 玻璃拟态效果：`backdrop-filter: blur()`
- 动态背景：浮动粒子 + 渐变光晕动画
- Discord 风格语音频道布局
- 响应式成员网格：`grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`

---

## 8. 构建与部署

### 8.1 开发模式

```bash
cd web
npm install
npm run dev        # Vite 开发服务器，默认 http://localhost:5173
```

### 8.2 生产构建

```bash
npm run build      # tsc + vite build → dist/
```

### 8.3 Docker 部署

```bash
docker build -t echolink-web .
# 或 docker-compose up（根目录）
```

Dockerfile 多阶段构建：
1. `node:20-slim` 构建生产包
2. `nginx:alpine` 托管静态文件
3. 复制 WASM/JS 静态资源到 Nginx

---

## 9. 已知问题与注意事项

| 问题 | 说明 |
|------|------|
| `index.html` title 为 "web" | 未改为 "EchoLink"，需要修正 |
| 无路由系统 | 单页面应用，仅 Room 一个组件 |
| 无测试 | `package.json` 有 `lint` 脚本但无测试框架 |
| 音频设备权限 | 首次使用需用户授权麦克风，否则 `enumerateDevices` 返回空标签 |
| `setSinkId` 兼容性 | 仅部分浏览器支持扬声器切换 |
| 降噪 WASM 路径 | `enhanced-noise-suppressor.js` 需放在 `public/` 目录，构建后复制到 `dist/` |
| 单 Producer 限制 | 一个 Peer 同时只能有一个音频 Producer（不支持多路音频） |

---

## 10. 扩展方向

- **视频支持**：当前仅音频，扩展 `types.ts` + `useMediasoup.ts` 增加 video Producer/Consumer
- **屏幕共享**：增加 `getDisplayMedia` 调用
- **音量调节**：为每个 Peer 增加独立音量控制
- **消息聊天**：复用 WebSocket 增加文字消息
- **PWA 支持**：增加 Service Worker + manifest
- **移动端适配**：当前为桌面优化，需调整布局

---

*文档结束。如需修改，请同步更新本文件。*
