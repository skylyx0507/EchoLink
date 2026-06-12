# EchoLink

> 实时游戏语音通话系统 — 自托管、低延迟、多平台

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)

**[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md)**

---

## 🎯 项目简介

EchoLink 是一款面向游戏场景的实时语音通话系统，支持多用户房间、麦克风开关、成员列表、语音活动检测（VAD）等功能。

- 🏠 **自托管**：部署在国内服务器，无需依赖商业 RTC 云服务
- ⚡ **低延迟**：基于 mediasoup SFU 架构，端到端延迟 < 100ms
- 🎮 **多平台**：Web 浏览器 + Windows 桌面客户端
- 🔊 **高音质**：Opus 编解码器，48kHz 采样率，支持 FEC 前向纠错
- 🛡️ **弱网适配**：支持 STUN/TURN 穿透，NAT 环境下稳定连接

---

## 🏗️ 技术架构

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| 媒体服务器 (SFU) | **mediasoup** (Node.js + TypeScript) | 音频流转发与路由 |
| 信令服务器 | **Node.js + TypeScript + ws** | 
| NAT 穿透 | **coturn** (STUN/TURN) | 弱网环境下的连接保障 |
| Web 客户端 | **React + TypeScript + mediasoup-client** | 浏览器端验证与测试 |
| Windows 客户端 | **C# + .NET 8 + WPF + NAudio** | 主要桌面客户端 |
| 音频编解码 | **Opus** (FEC 启用) | 弱网前向纠错 |
| 部署 | **Docker / docker-compose** | 服务器容器化 |

---

## 📁 仓库结构

```
EchoLink/
├── server/          # mediasoup SFU + WebSocket 信令服务器
│   ├── src/
│   │   ├── index.ts          # 入口：HTTP + WebSocket + mediasoup Worker
│   │   ├── signaling.ts      # 信令消息处理
│   │   ├── room.ts           # 房间管理
│   │   ├── peer.ts           # 对等端状态
│   │   ├── config.ts         # 服务器配置
│   │   ├── db.ts             # SQLite 用户持久化
│   │   ├── auth.ts           # JWT 认证
│   │   └── mediasoupWorker.ts # Worker / Router 初始化
│   └── package.json
├── web/             # React 测试客户端
│   ├── src/
│   │   ├── components/
│   │   │   ├── Room.tsx      # 房间界面
│   │   │   ├── RoomList.tsx  # 房间列表
│   │   │   ├── Login.tsx     # 登录页
│   │   │   └── Register.tsx  # 注册页
│   │   ├── hooks/
│   │   │   ├── useMediasoup.ts # mediasoup 逻辑封装
│   │   │   └── useAuth.ts    # 认证状态管理
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── windows/         # C# WPF 桌面客户端
│   └── VoiceChat/
│       ├── MainWindow.xaml     # UI 布局
│       ├── MainWindow.xaml.cs  # 业务逻辑
│       ├── LoginWindow.xaml    # 登录 UI
│       ├── LoginWindow.xaml.cs # 连接 + 认证逻辑
│       ├── RoomsWindow.xaml    # 房间列表 UI
│       ├── RoomsWindow.xaml.cs # 房间列表逻辑
│       ├── AuthService.cs      # HTTP 认证 / 房间列表服务
│       └── VoiceChat.csproj
├── docker-compose.yml
└── README.md
```

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- .NET 8 SDK
- Docker (可选，用于部署)

### 1. 启动服务器

```bash
cd server
npm install
npm run dev          # 开发模式（ts-node）
# 或
npm run build      # 编译
npm start          # 生产模式
```

服务器默认监听 `ws://localhost:1985`。

### 2. 启动 Web 客户端

```bash
cd web
npm install
npm run dev        # Vite 开发服务器，默认 http://localhost:5173
```

打开两个浏览器标签页，进入同一房间，测试双向语音。

### 3. 启动 Windows 客户端

```bash
cd windows
dotnet restore
dotnet build
dotnet run --project VoiceChat
```

---

## 📡 信令协议

基于 JSON 的 WebSocket 信令协议，核心消息类型：

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `joinRoom` | C→S | 加入房间 |
| `joinedRoom` | S→C | 加入成功，返回 RTP 能力 |
| `createTransport` | C→S | 创建 WebRTC Transport |
| `transportCreated` | S→C | Transport 创建成功 |
| `connectTransport` | C→S | 完成 DTLS 握手 |
| `transportConnected` | S→C | 连接成功 |
| `produce` | C→S | 开始发送音频 |
| `produced` | S→C | Producer 创建成功 |
| `consume` | C→S | 请求接收其他用户音频 |
| `consumed` | S→C | Consumer 创建成功 |
| `resumeConsuming` | C→S | 恢复音频接收 |
| `newProducer` | S→C (广播) | 新用户开麦通知 |
| `producerClosed` | S→C (广播) | 用户关麦通知 |
| `peerJoined` / `peerLeft` | S→C (广播) | 用户进出房间 |
| `authenticate` | C→S | 可选 JWT 认证 |
| `authenticated` | S→C | 认证成功 |
| `listRooms` | C→S | 请求在线房间列表 |
| `roomsList` | S→C | 在线房间列表响应 |

**关键顺序**：创建 Transport → 连接 Transport → 生产/消费。跳过 `connectTransport` 会导致静默失败。

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册新账号 |
| POST | `/api/auth/login` | 登录获取 JWT |
| GET | `/api/rooms` | 获取在线房间列表 |

---

## 🎛️ 音频配置

- **编解码器**：Opus
- **采样率**：48,000 Hz
- **声道**：2 (立体声)
- **FEC**：启用 (`useinbandfec=1`)
- **帧大小**：20ms (960 采样点)
- **比特率**：64 kbps

---

## 🐳 Docker 部署

```bash
docker-compose up -d
```

注意：`docker-compose.yml` 已将 `./data` 挂载到 server 容器以持久化 SQLite 数据库。生产环境请在 `.env` 中设置强 `JWT_SECRET`。

---

## 📝 开发规范

1. mediasoup API 必须严格遵循官方文档，禁止猜测方法名或参数
2. 实现 transport/producer/consumer 逻辑前，先写注释描述完整协商流程
3. 禁止在客户端代码中硬编码密钥或凭证，使用服务器配置或环境变量
4. 每个模块实现后，提供本地运行/验证命令
5. 聚焦当前步骤，不要提前生成未来步骤的代码

---

## 📄 许可证

[MIT](LICENSE)

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

- 报告 Bug 时请附上浏览器 Console 和服务器日志
- 提交功能请求请描述具体使用场景

---

*Made with ❤️ for gamers.*
