# EchoLink Windows 客户端 — AI 理解文档

> 本文档基于源码分析生成，供 AI 助手快速理解 `windows/` 目录下的项目结构、架构与开发约束。
> 生成时间：2025-06-06
> 对应仓库：`EchoLink`（实时游戏语音通话系统）

---

## 1. 项目定位

`windows/` 目录包含 **EchoLink 的 Windows 桌面客户端** —— 一个基于 WPF 的实时语音通话应用，面向游戏场景设计。

- 与 `server/`（mediasoup SFU + WebSocket 信令）和 `web/`（React 验证客户端）同属一个 Monorepo
- 是项目的**主要桌面客户端**（Primary client）
- 通过 **WebSocket + PlainTransport/RTP** 与服务器通信（非完整 WebRTC 栈）

---

## 2. 技术栈

| 组件 | 版本/包 | 用途 |
|------|---------|------|
| .NET | 8.0 | 运行时与 SDK |
| WPF | .NET 8 WPF | UI 框架（XAML + 代码后置） |
| NAudio | 2.2.1 | 音频捕获（麦克风）与播放（扬声器） |
| Concentus | 2.2.2 | Opus 编解码器（纯 C# 实现，无 native 依赖） |
| WebSocketSharp | 1.0.3-rc11 | WebSocket 客户端（信令通道） |
| 项目类型 | `Microsoft.NET.Sdk` / `WinExe` / `UseWPF` | 标准 WPF 桌面应用 |

**注意**：仓库根目录的 `CLAUDE.md` 提到 Windows 客户端使用 **SIPSorcery**，但实际代码中**并未引入 SIPSorcery**。当前实现采用更轻量的方案：WebSocketSharp 处理信令，原始 UDP/RTP 直接收发音频包，由服务器端的 mediasoup PlainTransport 对接。

---

## 3. 目录结构

```
windows/
├── EchoLink.slnx              # 新版 Solution 文件（XML 格式，当前为空标签）
├── VoiceChat/
│   ├── VoiceChat.csproj       # 项目文件：引用 NAudio / Concentus / WebSocketSharp
│   ├── App.xaml               # 应用入口资源（StartupUri = LoginWindow.xaml）
│   ├── App.xaml.cs            # 应用类（空实现，仅模板代码）
│   ├── AssemblyInfo.cs        # WPF 主题资源字典定位配置
│   ├── Properties/
│   │   └── launchSettings.json # 启动配置（无特殊参数）
│   ├── LoginWindow.xaml       # 登录窗口 UI：服务器地址、房间号、昵称、主题选择
│   ├── LoginWindow.xaml.cs    # 登录逻辑：端口探测、设置持久化、主题切换、打开主窗口
│   ├── MainWindow.xaml        # 主窗口 UI：频道头部、成员列表、底部控制栏
│   └── MainWindow.xaml.cs     # 核心逻辑：WebSocket 信令、RTP 收发、Opus 编解码、音频设备管理
```

---

## 4. 核心文件详解

### 4.1 `LoginWindow.xaml` / `.cs` — 连接入口

**UI 特点**：
- 无边框窗口（`WindowStyle=None, AllowsTransparency=True`）
- 圆角卡片设计（`CornerRadius=12`）+ 阴影效果
- 自定义标题栏（Logo + 最小化/关闭按钮）
- 支持拖拽移动（`MouseLeftButtonDown → DragMove`）
- 5 种主题切换：dark / light / purple / ocean / sunset

**核心逻辑**：
- **设置持久化**：`%APPDATA%/EchoLink/settings.json` 保存服务器、房间、昵称、主题
- **端口探测**：若用户输入不含端口的地址，自动探测 `3000, 8080, 80`
- **WebSocket URL 构造**：支持 `ws://` / `wss://` 前缀，或自动补全
- **打开主窗口**：验证通过后实例化 `MainWindow` 并关闭自身

**关键方法**：
| 方法 | 说明 |
|------|------|
| `LoadSettings()` | 从 JSON 文件恢复上次输入 |
| `SaveSettings()` | 保存当前输入到 JSON |
| `ProbePortAsync(host)` | 并行 TCP 探测端口 |
| `ApplyTheme(theme)` | 动态切换窗口配色 |
| `JoinBtn_Click()` | 验证 → 保存 → 打开 MainWindow |

---

### 4.2 `MainWindow.xaml` / `.cs` — 语音房间核心

#### 4.2.1 UI 布局（XAML）

三行网格结构：

```
┌─────────────────────────────────────────┐
│  频道头部（RoomName + 设备选择 + 降噪 + 断开） │  ← Row 0
├─────────────────────────────────────────┤
│                                         │
│         成员卡片列表（WrapPanel）          │  ← Row 1
│                                         │
├─────────────────────────────────────────┤
│  底部控制栏（头像 + 麦克风按钮 + 在线人数）   │  ← Row 2
└─────────────────────────────────────────┘
```

**样式资源**（全部内联在 `Window.Resources`）：
- 颜色画刷系统：`BgBrush`, `TextBrush`, `PrimaryBrush`, `SuccessBrush`, `DangerBrush` 等
- 渐变头像画刷：`AvatarSelfBrush`（紫蓝渐变）、`AvatarOtherBrush`（绿渐变）、`AvatarMutedBrush`（灰渐变）
- 说话光环动画：`SpeakingStoryboard`（双层脉冲缩放 + 透明度）
- 圆形按钮样式：`CircleButtonStyle`
- 降噪单选按钮：`NoiseButtonStyle`
- 设备下拉框：`DeviceComboStyle`（自定义 Popup + 阴影）
- 断开按钮：`DisconnectButtonStyle`（悬停变红底）

#### 4.2.2 核心逻辑（C#）

**字段总览**：

| 类别 | 字段 | 说明 |
|------|------|------|
| 网络 | `_ws` | WebSocketSharp 客户端 |
| 网络 | `_serverUrl`, `_roomId`, `_peerId` | 连接参数 |
| mediasoup | `_sendTransportId`, `_recvTransportId` | PlainTransport ID |
| RTP | `_udpClient` | 收发共用 UdpClient |
| RTP | `_serverSendEndPoint` | 服务器接收端点 |
| RTP | `_sendSeq`, `_sendTimestamp`, `_sendSsrc` | RTP 包头状态 |
| 音频 | `_micCapture` | NAudio WaveInEvent |
| 音频 | `_audioOutput` | NAudio WaveOutEvent |
| 音频 | `_playbackBuffer` | BufferedWaveProvider |
| 音频 | `_opusEncoder`, `_opusDecoder` | Concentus Opus 编解码器 |
| 设备 | `_selectedMicDevice`, `_selectedSpeakerDevice` | 设备索引（-1 = 默认） |
| 状态 | `_micEnabled`, `_isSpeaking` | 麦克风/说话状态 |
| 成员 | `_peers` | `Dictionary<string, PeerInfo>` |
| 消息 | `_pendingMessages` | `Dictionary<string, TaskCompletionSource<JsonElement>>` |

**音频参数常量**：
```csharp
const int SampleRate = 48000;      // 48kHz
const int OpusChannels = 2;          // 立体声（mediasoup 要求）
const int FrameSize = 960;         // 20ms @ 48kHz
_opusEncoder.Bitrate = 64000;      // 64 kbps
_opusEncoder.UseInbandFEC = true;  // 前向纠错
```

---

## 5. 信令流程

### 5.1 加入房间（`JoinRoomAsync`）

```
1. 初始化 Opus Encoder/Decoder
2. 初始化 UdpClient（系统分配端口，收发共用）
3. 连接 WebSocket
4. joinRoom → 等待 joinedRoom
5. createPlainTransport (send) → 等待 plainTransportCreated
   → 记录 _sendTransportId + _serverSendEndPoint
6. createPlainTransport (recv) → 等待 plainTransportCreated
   → 记录 _recvTransportId + recvIp/recvPort
7. 发送 dummy RTP 到 recv 端点（触发 mediasoup comedia 模式）
8. 启动 RTP 接收循环（StartRtpReceiver）
9. 初始化 UI（设备列表、房间名、自己卡片、在线人数）
10. 消费已有 Producer（existingProducers）
11. 添加已有 Peer（existingPeers）
```

### 5.2 开麦（`EnableMic`）

```
1. 创建 WaveInEvent（48kHz, 16bit, 单声道, 20ms 缓冲）
2. 订阅 DataAvailable 事件
3. 更新 UI：麦克风已开
4. 发送 produce 请求（含 RTP 参数）
5. 等待 produced 响应
   → 失败则自动 DisableMic 并弹窗
```

### 5.3 关麦（`DisableMic`）

```
1. 停止 WaveInEvent
2. 取消订阅 DataAvailable
3. 释放资源
4. 更新 UI：麦克风已关 + 停止说话动画
```

### 5.4 接收远程音频（`ConsumeRemoteAsync`）

```
1. 发送 consume 请求（producerId + rtpCapabilities）
2. 等待 consumed 响应
3. 发送 resumeConsuming（consumerId）
4. 更新对应 Peer 的 UI 卡片（麦克风状态 = 开）
```

### 5.5 消息处理（`HandleMessage`）

| 消息类型 | 处理 |
|----------|------|
| `joinedRoom` | 完成 WaitForMessage，进入房间 |
| `plainTransportCreated` | 完成 WaitForMessage，记录 Transport 信息 |
| `produced` / `consumed` / `transportConnected` | 完成对应的 WaitForMessage |
| `newProducer` | 调用 ConsumeRemoteAsync |
| `producerClosed` | 更新 Peer 卡片为静音状态 |
| `peerJoined` | 添加新成员卡片 |
| `peerLeft` | 移除成员卡片 |
| `error` | MessageBox 弹窗 |

---

## 6. RTP 音频处理

### 6.1 发送（`SendRtpAudio`）

```
PCM 单声道数据（16bit, 48kHz）
  → 分帧（每帧 960 采样点 = 20ms）
  → 单声道 → 双声道复制（L = R）
  → Opus Encode（Concentus）
  → 组装 RTP 包（12 字节头 + Opus payload）
  → UDP 发送到 _serverSendEndPoint
```

RTP 包头格式：
```
byte 0:  0x80 (V=2, P=0, X=0, CC=0)
byte 1:  0x6F (PT=111, M=0)
byte 2-3:   sequence number (递增)
byte 4-7:   timestamp (递增 FrameSize)
byte 8-11:  SSRC (随机生成，固定)
```

### 6.2 接收（`ProcessIncomingRtp`）

```
UDP 接收 RTP 包
  → 解析 RTP 头（跳过 CSRC + Extension）
  → 提取 Opus payload
  → Opus Decode（Concentus）→ 双声道 short[]
  → 双声道 → 单声道（只取左声道 L）
  → 写入 BufferedWaveProvider
  → WaveOutEvent 播放
```

**注意**：播放端强制单声道（`WaveFormat(SampleRate, 16, 1)`），解码时丢弃右声道。

### 6.3 语音活动检测（VAD）

在 `OnMicDataAvailable` 中实时计算：
```csharp
float max = 0;
for (int i = 0; i < e.BytesRecorded; i += 2)
{
    float lvl = Math.Abs(BitConverter.ToInt16(e.Buffer, i) / 32768f);
    if (lvl > max) max = lvl;
}
Dispatcher.BeginInvoke(() => SetSpeaking(max > 0.05f));
```

阈值 `0.05`（约 -26dB）触发说话动画。

---

## 7. 主题系统

### 7.1 LoginWindow 主题

5 种预设主题，每种定义 9 个颜色值：
- `dark` — Discord 风格深色
- `light` — 浅色模式
- `purple` — 紫色调
- `ocean` — 海洋蓝调
- `sunset` — 日落暖调

主题通过动态替换 `Window.Resources` 中的画刷实现。

### 7.2 MainWindow 主题

由 `ApplyTheme(theme)` 方法在构造函数中调用，同样替换资源字典中的画刷。注意 MainWindow 默认 XAML 中定义的是 slate 色系（`#0f172a` 等），主题切换会覆盖这些值。

---

## 8. 构建与运行

```bash
cd windows

# 还原依赖
dotnet restore

# 构建
dotnet build

# 运行
dotnet run --project VoiceChat

# 或指定启动项目
dotnet run --project windows/VoiceChat/VoiceChat.csproj
```

**依赖包自动恢复**：`VoiceChat.csproj` 中引用的 NAudio、Concentus、WebSocketSharp 会在 `dotnet restore` 时从 NuGet 下载。

---

## 9. 与 Server 的对接要点

### 9.1 使用的信令消息（C# 客户端 → Server）

| 消息 | 参数 | 说明 |
|------|------|------|
| `joinRoom` | `roomId`, `peerId` | 加入房间 |
| `createPlainTransport` | `direction: "send"` / `"recv"` | 创建 PlainTransport |
| `produce` | `kind`, `rtpParameters` | 开始发送音频 |
| `consume` | `producerId`, `rtpCapabilities` | 请求接收音频 |
| `resumeConsuming` | `consumerId` | 恢复 Consumer |
| `leaveRoom` | — | 离开房间 |

### 9.2 接收的信令消息（Server → C# 客户端）

| 消息 | 关键字段 |
|------|----------|
| `joinedRoom` | `existingPeers`, `existingProducers`, `rtpCapabilities` |
| `plainTransportCreated` | `id`, `ip`, `port` |
| `produced` | `producerId` |
| `consumed` | `consumerId`, `rtpParameters` |
| `newProducer` | `producerId`, `peerId` |
| `producerClosed` | `peerId` |
| `peerJoined` / `peerLeft` | `peerId` |
| `error` | `message` |

### 9.3 与 Web 客户端的差异

| 特性 | Web 客户端 | Windows 客户端 |
|------|-----------|----------------|
| 传输类型 | WebRtcTransport（ICE + DTLS） | PlainTransport（原始 RTP/UDP） |
| 信令库 | mediasoup-client | 手写 WebSocket + JSON |
| 音频 API | Web Audio API | NAudio |
| 编解码 | 浏览器内置 Opus | Concentus（纯 C#） |
| 降噪 | rnnoise-wasm | 未实现（UI 占位） |

---

## 10. 已知问题与注意事项

### 10.1 当前代码问题

| 问题 | 位置 | 说明 |
|------|------|------|
| `NoiseLevel_Click` 空实现 | `MainWindow.xaml.cs:148` | ~~降噪按钮点击无实际效果~~ ✅ **已修复** — Phase 1 实现 VAD 阈值 + 噪声门限；Phase 2 集成 RNNoise AI 降噪 |
| 扬声器设备切换不实时 | `MainWindow.xaml.cs` | 切换 ComboBox 只更新索引，不重新初始化 WaveOut |
| 麦克风设备切换不实时 | `MainWindow.xaml.cs` | 同上，开麦后切换设备不生效 |
| 单 Worker 依赖 | 服务端架构 | 服务端仅 1 个 mediasoup Worker，无法利用多核 |
| 无重连机制 | `MainWindow.xaml.cs` | WebSocket 断开后直接关闭窗口，无自动重连 |
| 内存泄漏风险 | `MainWindow.xaml.cs` | `OnMicDataAvailable` 中 `Dispatcher.BeginInvoke` 高频调用可能堆积 |
| 异常吞掉 | `SendRtpAudio`, `ProcessIncomingRtp` | 多个 `catch { }` 空处理，问题难排查 |
| 硬编码 RTP PayloadType | `SendRtpAudio` | `0x6F` = 111，与 mediasoup 默认一致但无校验 |

### 10.2 与 CLAUDE.md 的不一致

| CLAUDE.md 描述 | 实际代码 | 建议 |
|---------------|---------|------|
| 使用 **SIPSorcery** | 未引用 SIPSorcery，使用 WebSocketSharp + 原始 RTP | 文档已过时，需更新 CLAUDE.md |
| 开发序列 Step 3 提到 SDP 协商 | 无 SDP 协商，使用 PlainTransport 直接 RTP | PlainTransport 绕过了 WebRTC 握手，是简化方案 |

### 10.3 开发约束（来自根目录 CLAUDE.md）

1. **mediasoup API 必须严格遵循官方文档**，禁止猜测方法名或参数
2. 实现 transport/producer/consumer 逻辑前，**先写注释描述完整协商流程**
3. **禁止在客户端硬编码密钥或凭证**
4. 每个模块实现后，**提供本地运行/验证命令**
5. **聚焦当前步骤**，不要提前生成未来步骤的代码

---

## 11. 扩展方向

- **降噪实现**：集成 RNNoise 或 WebRTC AEC（当前 UI 已预留按钮）
- **设备热切换**：切换 ComboBox 时自动重启音频流
- **音量调节**：添加输入/输出增益滑块
- **快捷键**：全局热键切换麦克风（如 Ctrl+Shift+M）
- **系统托盘**：最小化到托盘，保持后台语音
- **重连机制**：WebSocket 断开后自动重连 + 恢复房间状态
- **多房间**：支持同时加入多个语音频道
- **屏幕共享**：利用 mediasoup 视频能力扩展

---

*文档结束。如需修改，请同步更新本文件。*
