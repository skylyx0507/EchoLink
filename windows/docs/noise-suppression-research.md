# EchoLink Windows 客户端降噪实现调研报告

> 调研时间：2025-06-06
> 调研范围：Windows 平台实时音频降噪方案，适配 C# + NAudio + 48kHz 单声道输入场景

---

## 1. 项目约束条件

在评估方案前，先明确当前代码的音频处理链路：

```
麦克风(NAudio WaveInEvent)
  → 48kHz, 16bit, 单声道, 20ms缓冲(960采样点)
  → OnMicDataAvailable 事件
    → VAD检测(计算音量峰值)
    → SendRtpAudio()
      → 单声道→双声道复制
      → Concentus Opus Encode
      → RTP打包 → UDP发送
```

**关键约束**：

| 参数 | 值 | 影响 |
|------|-----|------|
| 采样率 | 48,000 Hz | 降噪算法必须支持 48kHz 或需重采样 |
| 位深 | 16-bit PCM | 降噪算法输入可能需要 float 转换 |
| 声道 | 单声道(输入) | 降噪只需处理单声道 |
| 帧大小 | 20ms (960采样点) | 降噪算法帧大小需匹配或兼容 |
| 实时性 | < 20ms 处理延迟 | 排除离线/高延迟方案 |
| 运行时 | .NET 8 WPF | 优先纯 C# 或 P/Invoke DLL，避免 C++/CLI |
| 已有依赖 | NAudio, Concentus | 避免引入重量级框架 |

---

## 2. 候选方案对比

### 2.1 RNNoise（Mozilla）⭐ 推荐

**技术概况**：
- 作者：Jean-Marc Valin（也是 Opus 编解码器作者）
- 架构：GRU 循环神经网络 + 传统信号处理（混合式）
- 模型大小：约 85KB（权重以 8-bit 量化存储）
- 性能：x86 CPU 上约 **60x 实时**（Raspberry Pi 3 上约 7x 实时）
- 许可：BSD-3-Clause

**输入输出规格**：
- 采样率：**48kHz**（原生支持，无需重采样 ✅）
- 帧大小：**480 采样点 = 10ms**（当前项目 20ms 帧可拆分为 2 个 10ms 帧）
- 格式：float 数组（需将 16-bit PCM 转换为 [-1, 1] float）
- 声道：单声道

**C API**（需编译为 DLL 后 P/Invoke）：
```c
// 创建状态
DenoiseState *rnnoise_create(RNNModel *model);  // model=NULL 使用内置模型
void rnnoise_destroy(DenoiseState *st);

// 处理一帧（480 采样点）
// 返回语音概率(VAD)，out 为降噪后的输出
float rnnoise_process_frame(DenoiseState *st, float *out, const float *in);
```

**与项目契合度**：

| 维度 | 评分 | 说明 |
|------|------|------|
| 采样率匹配 | ✅ 完美 | 原生 48kHz，无需重采样 |
| 实时性能 | ✅ 优秀 | 60x 实时，CPU 占用极低 |
| 模型大小 | ✅ 优秀 | 85KB，可嵌入资源或随 DLL 分发 |
| 集成难度 | ⚠️ 中等 | 需自行编译 DLL + 写 P/Invoke 封装 |
| 与 Web 端一致 | ✅ 优秀 | Web 端已用 `@jitsi/rnnoise-wasm`，同技术栈 |
| 质量 | ✅ 良好 | 对风扇/键盘/交通噪声效果优秀；对音乐/人声噪声稍弱 |

**已知限制**：
- 仅支持 48kHz / 单声道 / 480 采样点帧
- 对非平稳噪声（如突然的关门声、电视人声）处理不如 DeepFilterNet
- 输入音量敏感：音量过低时可能误判为噪声
- 无官方 C# 绑定，需自行封装

---

### 2.2 DeepFilterNet（RWTH Aachen）

**技术概况**：
- 德国亚琛工业大学研发，2021-2025 持续迭代
- 架构：CNN + RNN 混合，两阶段处理（ERB 增益 + 深度滤波）
- 最新版：DeepFilterNet3（PESQ 3.17，STOI 0.944）
- 实时因子：0.19（单线程，笔记本 i5-8250U）
- 延迟：约 40ms（含 2 帧 lookahead）
- 许可：MIT / Apache-2.0

**输入输出规格**：
- 采样率：48kHz ✅
- 帧大小：20ms 窗口，10ms hop size
- 实现语言：Rust（libDF）+ Python（PyTorch）

**与项目契合度**：

| 维度 | 评分 | 说明 |
|------|------|------|
| 降噪质量 | ✅ 优秀 | 优于 RNNoise，尤其非平稳噪声 |
| 实时性能 | ⚠️ 一般 | 0.19 实时因子，比 RNNoise 重 |
| 模型大小 | ❌ 较大 | 模型文件数 MB 级 |
| 集成难度 | ❌ 困难 | 无 C# 绑定，需 Rust→C→C# 多层封装 |
| 延迟 | ⚠️ 偏高 | 40ms lookahead，对游戏语音略高 |

**结论**：质量最好但集成成本过高，不适合当前阶段。

---

### 2.3 WebRTC APM（Audio Processing Module）

**技术概况**：
- Google WebRTC 内置音频处理栈
- 包含：NS（噪声抑制）+ AEC（回声消除）+ AGC（自动增益）+ HPF（高通滤波）+ VAD
- NS 算法：谱减法（传统 DSP，非 AI）
- 实现：C++

**与项目契合度**：

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整度 | ✅ 优秀 | 一站式解决 NS+AEC+AGC+HPF |
| 降噪质量 | ⚠️ 一般 | 传统谱减法，质量不如 RNNoise/DeepFilterNet |
| 集成难度 | ❌ 困难 | C++ 库编译复杂，依赖重 |
| 已有 C# 绑定 | ⚠️ 有但老旧 | StarTrinity 有 C# 移植版，但多年未更新 |
| 回声消除 | ✅ 唯一优势 | 如果未来需要 AEC，这是最佳起点 |

**结论**：如果同时需要 AEC，值得考虑；仅降噪则过重。

---

### 2.4 SpeexDSP

**技术概况**：
- Xiph.Org 传统 DSP 库
- NS 算法：谱减法
- 有 C# 封装（NSpeex 等）

**与项目契合度**：

| 维度 | 评分 | 说明 |
|------|------|------|
| 降噪质量 | ❌ 差 | 已被 RNNoise/DeepFilterNet 全面超越 |
| 集成难度 | ✅ 简单 | 有现成 C# 封装 |
| 时代性 | ❌ 过时 | 2022 年后无实质更新 |

**结论**：不推荐新项目中使用。

---

### 2.5 Windows 内置 Voice Capture DSP

**技术概况**：
- Windows 10+ 内置的音频效果链
- 包含：降噪、回声消除、自动增益
- 通过 `Windows.Media.Audio` 或 WASAPI 效果链访问

**与项目契合度**：

| 维度 | 评分 | 说明 |
|------|------|------|
| 集成难度 | ⚠️ 中等 | UWP API 在 WPF 中需 COM 互操作 |
| 可控性 | ❌ 差 | 黑盒实现，无法调参 |
| 兼容性 | ⚠️ 一般 | 不同 Windows 版本行为可能不一致 |
| 零依赖 | ✅ 优秀 | 无需额外 DLL |

**结论**：可控性差，不适合需要精细控制的场景。

---

## 3. 方案推荐

### 3.1 总体推荐排序

| 优先级 | 方案 | 适用场景 | 预估工作量 |
|--------|------|----------|-----------|
| 1 | **RNNoise P/Invoke** | 当前最佳平衡：质量、性能、一致性 | 1-2 天 |
| 2 | **VAD 阈值调节（临时）** | 立即实现"低/中/高"按钮功能 | 2 小时 |
| 3 | **WebRTC APM** | 未来需要 AEC 时统一引入 | 3-5 天 |
| 4 | **DeepFilterNet** | 对降噪质量有极致要求时 | 5-7 天 |

### 3.2 推荐实现路径（分阶段）

```
Phase 1（立即）: VAD 阈值调节
  → 实现 NoiseLevel_Click 的低/中/高/关闭逻辑
  → 调节 VAD 阈值 + 可选简单增益门限
  → 用户可感知"降噪效果"

Phase 2（短期）: RNNoise 集成
  → 编译 RNNoise 为 x64 DLL
  → 写 C# P/Invoke 封装类
  → 在 OnMicDataAvailable 中插入降噪处理
  → 替换 Phase 1 的临时方案

Phase 3（长期）: WebRTC APM（如需 AEC）
  → 引入完整音频处理栈
  → 同时解决回声消除问题
```

---

## 4. RNNoise 集成详细方案

### 4.1 编译 RNNoise Windows DLL

**步骤**：

```bash
# 1. 克隆源码
git clone https://github.com/xiph/rnnoise.git
cd rnnoise

# 2. 使用 MSYS2/MinGW 或 Visual Studio 编译
# 方案 A：MSYS2 (推荐，最简单)
pacman -S mingw-w64-x86_64-toolchain
./autogen.sh
./configure --host=x86_64-w64-mingw32
make

# 方案 B：CMake (如需 VS 集成)
# 需自行写 CMakeLists.txt 封装

# 3. 产出
# librnnoise-0.dll  → 复制到项目输出目录
```

**注意**：RNNoise 的 `autogen.sh` 会自动从 Xiph 服务器下载模型文件（较大），确保网络畅通。

### 4.2 C# P/Invoke 封装

```csharp
using System;
using System.Runtime.InteropServices;

namespace VoiceChat.Audio;

/// <summary>
/// RNNoise 降噪封装
/// 帧大小：480 采样点 @ 48kHz = 10ms
/// </summary>
public sealed class RnnoiseDenoiser : IDisposable
{
    private const string DllName = "librnnoise-0.dll";
    private const int FrameSize = 480; // 10ms @ 48kHz

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr rnnoise_create(IntPtr model);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void rnnoise_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern float rnnoise_process_frame(IntPtr st, float[] outData, float[] inData);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rnnoise_get_size();

    private IntPtr _state;
    private readonly float[] _frameBuffer = new float[FrameSize];
    private readonly float[] _outputBuffer = new float[FrameSize];

    // 用于处理 20ms(960采样点) → 2×10ms(480采样点)
    private readonly float[] _pending = new float[FrameSize];
    private int _pendingCount = 0;

    public RnnoiseDenoiser()
    {
        _state = rnnoise_create(IntPtr.Zero); // 使用内置模型
        if (_state == IntPtr.Zero)
            throw new InvalidOperationException("RNNoise 初始化失败");
    }

    /// <summary>
    /// 处理 16-bit PCM 数据，返回降噪后的 16-bit PCM
    /// 输入长度任意，输出长度 ≤ 输入长度
    /// </summary>
    public void Process(ReadOnlySpan<byte> pcm16, List<byte> output)
    {
        // 将 16-bit PCM 转换为 float [-1, 1]
        int sampleCount = pcm16.Length / 2;
        var floatSamples = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
        {
            short s = BitConverter.ToInt16(pcm16, i * 2);
            floatSamples[i] = s / 32768f;
        }

        int offset = 0;

        // 先处理上次遗留的 pending
        if (_pendingCount > 0)
        {
            int need = FrameSize - _pendingCount;
            int take = Math.Min(need, sampleCount);
            Array.Copy(floatSamples, 0, _pending, _pendingCount, take);
            _pendingCount += take;
            offset += take;

            if (_pendingCount == FrameSize)
            {
                rnnoise_process_frame(_state, _outputBuffer, _pending);
                AppendFloatToPcm16(_outputBuffer, output);
                _pendingCount = 0;
            }
        }

        // 处理完整的 480 采样点帧
        while (offset + FrameSize <= sampleCount)
        {
            Array.Copy(floatSamples, offset, _frameBuffer, 0, FrameSize);
            rnnoise_process_frame(_state, _outputBuffer, _frameBuffer);
            AppendFloatToPcm16(_outputBuffer, output);
            offset += FrameSize;
        }

        // 保存剩余的采样点到 pending
        int remaining = sampleCount - offset;
        if (remaining > 0)
        {
            Array.Copy(floatSamples, offset, _pending, 0, remaining);
            _pendingCount = remaining;
        }
    }

    /// <summary>
    /// 刷新剩余数据（用静音填充最后一帧）
    /// </summary>
    public void Flush(List<byte> output)
    {
        if (_pendingCount > 0)
        {
            Array.Clear(_pending, _pendingCount, FrameSize - _pendingCount);
            rnnoise_process_frame(_state, _outputBuffer, _pending);
            AppendFloatToPcm16(_outputBuffer, output);
            _pendingCount = 0;
        }
    }

    private static void AppendFloatToPcm16(float[] data, List<byte> output)
    {
        foreach (var f in data)
        {
            short s = (short)Math.Clamp(f * 32768f, short.MinValue, short.MaxValue);
            output.Add((byte)(s & 0xFF));
            output.Add((byte)((s >> 8) & 0xFF));
        }
    }

    public void Dispose()
    {
        if (_state != IntPtr.Zero)
        {
            rnnoise_destroy(_state);
            _state = IntPtr.Zero;
        }
    }
}
```

### 4.3 集成到现有音频链路

**修改位置**：`MainWindow.xaml.cs:532-546`

```csharp
// 新增字段
private RnnoiseDenoiser? _denoiser;
private NoiseLevel _noiseLevel = NoiseLevel.Off;

enum NoiseLevel { Off, Low, Medium, High }

// 在 EnableMic() 中初始化
private void EnableMic()
{
    // ... 原有代码 ...
    
    if (_noiseLevel != NoiseLevel.Off)
    {
        _denoiser = new RnnoiseDenoiser();
    }
    
    _micCapture.DataAvailable += OnMicDataAvailable;
    // ...
}

// 在 DisableMic() 中释放
private void DisableMic()
{
    _denoiser?.Dispose();
    _denoiser = null;
    // ... 原有代码 ...
}

// 修改 OnMicDataAvailable
private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
{
    if (!_micEnabled) return;

    // VAD 检测（保持原有逻辑）
    float max = 0;
    for (int i = 0; i < e.BytesRecorded; i += 2)
    {
        float lvl = Math.Abs(BitConverter.ToInt16(e.Buffer, i) / 32768f);
        if (lvl > max) max = lvl;
    }
    Dispatcher.BeginInvoke(() => SetSpeaking(max > 0.05f));

    byte[] pcmToSend;
    
    if (_denoiser != null && _noiseLevel != NoiseLevel.Off)
    {
        // 使用 RNNoise 降噪
        var output = new List<byte>(e.BytesRecorded);
        _denoiser.Process(e.Buffer.AsSpan(0, e.BytesRecorded), output);
        pcmToSend = output.ToArray();
    }
    else
    {
        // 旁路：不降噪
        pcmToSend = new byte[e.BytesRecorded];
        Array.Copy(e.Buffer, pcmToSend, e.BytesRecorded);
    }

    SendRtpAudio(pcmToSend);
}

// 实现 NoiseLevel_Click
private void NoiseLevel_Click(object sender, RoutedEventArgs e)
{
    if (sender is RadioButton btn && btn.Tag is string tag)
    {
        _noiseLevel = tag switch
        {
            "off" => NoiseLevel.Off,
            "low" => NoiseLevel.Low,
            "medium" => NoiseLevel.Medium,
            "high" => NoiseLevel.High,
            _ => NoiseLevel.Off
        };

        // 如果正在通话，动态切换
        if (_micEnabled)
        {
            if (_noiseLevel == NoiseLevel.Off)
            {
                _denoiser?.Dispose();
                _denoiser = null;
            }
            else if (_denoiser == null)
            {
                _denoiser = new RnnoiseDenoiser();
            }
        }
    }
}
```

### 4.4 项目文件修改

**`VoiceChat.csproj`** 添加 DLL 复制规则：

```xml
<ItemGroup>
  <!-- 已有引用 -->
  <PackageReference Include="Concentus" Version="2.2.2" />
  <PackageReference Include="NAudio" Version="2.2.1" />
  <PackageReference Include="WebSocketSharp" Version="1.0.3-rc11" />
</ItemGroup>

<!-- RNNoise DLL：编译时复制到输出目录 -->
<ItemGroup>
  <None Include="Native\librnnoise-0.dll">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
</ItemGroup>
```

---

## 5. Phase 1 临时方案：VAD 阈值调节

如果 RNNoise 集成需要更多时间，可先实现一个**立即可用**的临时方案：

```csharp
private void NoiseLevel_Click(object sender, RoutedEventArgs e)
{
    if (sender is RadioButton btn && btn.Tag is string tag)
    {
        _vadThreshold = tag switch
        {
            "off" => 0.00f,   // 不过滤
            "low" => 0.03f,   // 轻度（保留更多声音）
            "medium" => 0.05f,// 默认
            "high" => 0.10f,  // 严格（更多静音）
            _ => 0.05f
        };
    }
}

// 修改 OnMicDataAvailable 中的 VAD 判断
Dispatcher.BeginInvoke(() => SetSpeaking(max > _vadThreshold));

// 可选：增加简单噪声门限
if (max < _vadThreshold * 0.5f)
{
    // 将低音量采样点置零（简单门限）
    for (int i = 0; i < e.BytesRecorded; i += 2)
        Array.Clear(e.Buffer, i, 2);
}
```

**这不是真正的降噪**，只是调节了语音活动检测的灵敏度和简单门限，但可以让用户感知到"低/中/高"的区别。

---

## 6. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| RNNoise DLL 编译失败 | 依赖 autotools，Windows 环境可能不友好 | 使用 MSYS2/MinGW 预编译；或寻找社区预编译 DLL |
| P/Invoke 平台兼容性 | x64/x86 需对应 DLL | 项目已明确 x64（.NET 8 默认），只编译 x64 DLL |
| 浮点转换开销 | 每帧 960 采样点需 int16→float→int16 | 开销极小（< 0.1ms），可忽略 |
| 延迟增加 | RNNoise 处理引入额外延迟 | 约 10ms（一帧），对游戏语音可接受 |
| 模型兼容性 | RNNoise 内置模型固定 | 如需自定义模型，需重新编译 DLL |
| 内存分配 | `Process()` 中频繁 new List | 可优化为使用 `ArrayPool` 或预分配缓冲区 |

---

## 7. 参考资源

| 资源 | 链接 | 用途 |
|------|------|------|
| RNNoise 源码 | https://github.com/xiph/rnnoise | 编译 DLL |
| RNNoise 论文 | arXiv:1709.08243 | 理解算法原理 |
| RNNoise VST 插件 | https://github.com/werman/noise-suppression-for-voice | 参考集成方式 |
| Web 端 RNNoise WASM | `@jitsi/rnnoise-wasm` | 与 Web 端保持一致 |
| DeepFilterNet | https://github.com/Rikorose/DeepFilterNet | 未来升级参考 |
| WebRTC APM | https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing | AEC 需求时参考 |

---

## 8. 结论

**首选方案：RNNoise P/Invoke**

理由：
1. **与 Web 端技术栈一致** — 都用 RNNoise，便于统一调试和优化
2. **零重采样** — 原生 48kHz 匹配项目音频参数
3. **性能优秀** — 60x 实时，游戏场景 CPU 占用可忽略
4. **模型极小** — 85KB，不增加分发体积
5. **Opus 作者作品** — 与项目已有 Concentus(Opus) 同属 Xiph.Org 生态

**建议执行顺序**：
1. 先实现 Phase 1 临时 VAD 阈值方案（2 小时，立即可用）
2. 并行编译 RNNoise DLL（1 天）
3. 实现 Phase 2 RNNoise 集成（1 天）
4. 测试对比：关闭 / 低 / 中 / 高 的实际效果

---

*报告结束。如需进入实现阶段，可从 Phase 1 临时方案开始。*
