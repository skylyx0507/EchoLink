using System;
using System.Runtime.InteropServices;

namespace VoiceChat.Audio;

/// <summary>
/// WebRTC APM 降噪封装（直接 P/Invoke webrtc-apm.dll，不依赖 SoundFlow 框架）
///
/// 支持功能：
/// - 噪声抑制 (NS)：Low / Moderate / High / VeryHigh
/// - 自动增益控制 (AGC1/AGC2)
/// - 高通滤波 (HPF)
/// - 前置放大 (Pre-Amp)
///
/// 音频格式：48kHz 单声道 10ms 帧（480 采样点）
/// </summary>
public sealed class WebRtcNoiseSuppressor : IDisposable
{
    private const string DllName = "webrtc-apm";
    private const int SampleRate = 48000;
    private const int FrameSize = 480; // 10ms @ 48kHz

    #region Native P/Invoke

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr webrtc_apm_create();

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_destroy(IntPtr apm);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr webrtc_apm_config_create();

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_destroy(IntPtr config);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_noise_suppression(IntPtr config, int enabled, NoiseSuppressionLevel level);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_echo_canceller(IntPtr config, int enabled, int mobileMode);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_gain_controller1(IntPtr config, int enabled, int mode, int targetLevelDbfs, int compressionGainDb, int enableLimiter);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_gain_controller2(IntPtr config, int enabled);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_high_pass_filter(IntPtr config, int enabled);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_pre_amplifier(IntPtr config, int enabled, float fixedGainFactor);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_config_set_pipeline(IntPtr config, int maxInternalRate, int multiChannelRender, int multiChannelCapture, int downmixMethod);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int webrtc_apm_config_apply(IntPtr apm, IntPtr config);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int webrtc_apm_initialize(IntPtr apm);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr webrtc_apm_stream_config_create(int sampleRateHz, IntPtr numChannels);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void webrtc_apm_stream_config_destroy(IntPtr config);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int webrtc_apm_process_stream(IntPtr apm, IntPtr src, IntPtr inputConfig, IntPtr outputConfig, IntPtr dest);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int webrtc_apm_get_frame_size(int sampleRateHz);

    #endregion

    public enum NoiseSuppressionLevel
    {
        Low = 0,
        Moderate = 1,
        High = 2,
        VeryHigh = 3
    }

    private IntPtr _apm;
    private IntPtr _config;
    private IntPtr _inputStreamConfig;
    private IntPtr _outputStreamConfig;
    private readonly float[] _inputFrame;
    private readonly float[] _outputFrame;
    private readonly IntPtr _inputPtr;
    private readonly IntPtr _outputPtr;
    private readonly IntPtr _inputArrayPtr;
    private readonly IntPtr _outputArrayPtr;
    private bool _disposed;

    /// <summary>最近一帧的处理耗时（微秒）</summary>
    public long LastProcessTimeUs { get; private set; }

    public WebRtcNoiseSuppressor(
        NoiseSuppressionLevel nsLevel = NoiseSuppressionLevel.VeryHigh,
        bool enableAgc = true,
        bool enableHpFilter = true,
        float preAmpGain = 1.0f)
    {
        _apm = webrtc_apm_create();
        if (_apm == IntPtr.Zero)
            throw new InvalidOperationException("Failed to create WebRTC APM instance");

        _config = webrtc_apm_config_create();
        if (_config == IntPtr.Zero)
        {
            webrtc_apm_destroy(_apm);
            throw new InvalidOperationException("Failed to create APM config");
        }

        // 配置噪声抑制
        webrtc_apm_config_set_noise_suppression(_config, 1, nsLevel);

        // 配置 AGC1（自适应数字增益）
        if (enableAgc)
            webrtc_apm_config_set_gain_controller1(_config, 1, 1, 3, 6, 1); // AdaptiveDigital, target=-3dBFS, gain=6dB, limiter=on
        else
            webrtc_apm_config_set_gain_controller1(_config, 0, 0, 0, 0, 0);

        // 关闭 AGC2（避免和 AGC1 冲突）
        webrtc_apm_config_set_gain_controller2(_config, 0);

        // 高通滤波（去除低频噪声）
        webrtc_apm_config_set_high_pass_filter(_config, enableHpFilter ? 1 : 0);

        // 前置放大
        if (Math.Abs(preAmpGain - 1.0f) > 0.01f)
            webrtc_apm_config_set_pre_amplifier(_config, 1, preAmpGain);
        else
            webrtc_apm_config_set_pre_amplifier(_config, 0, 1.0f);

        // 关闭回声消除（不需要）
        webrtc_apm_config_set_echo_canceller(_config, 0, 0);

        // Pipeline 配置
        webrtc_apm_config_set_pipeline(_config, SampleRate, 0, 0, 0);

        // 应用配置
        int applyErr = webrtc_apm_config_apply(_apm, _config);
        if (applyErr != 0)
        {
            Dispose();
            throw new InvalidOperationException($"Failed to apply APM config: {applyErr}");
        }

        // 初始化
        int initErr = webrtc_apm_initialize(_apm);
        if (initErr != 0)
        {
            Dispose();
            throw new InvalidOperationException($"Failed to initialize APM: {initErr}");
        }

        // 创建流配置（单声道）
        IntPtr one = new IntPtr(1);
        _inputStreamConfig = webrtc_apm_stream_config_create(SampleRate, one);
        _outputStreamConfig = webrtc_apm_stream_config_create(SampleRate, one);

        // 分配帧缓冲
        _inputFrame = new float[FrameSize];
        _outputFrame = new float[FrameSize];
        _inputPtr = Marshal.AllocHGlobal(FrameSize * sizeof(float));
        _outputPtr = Marshal.AllocHGlobal(FrameSize * sizeof(float));

        // 分配通道指针数组（单通道）
        _inputArrayPtr = Marshal.AllocHGlobal(IntPtr.Size);
        _outputArrayPtr = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(_inputArrayPtr, _inputPtr);
        Marshal.WriteIntPtr(_outputArrayPtr, _outputPtr);
    }

    /// <summary>
    /// 处理 16-bit PCM 数据，返回降噪 + 增益后的 16-bit PCM。
    /// 输入必须是单声道 48kHz，长度任意（内部按 10ms 帧处理）。
    /// </summary>
    public byte[] Process(ReadOnlySpan<byte> pcm16)
    {
        int sampleCount = pcm16.Length / 2;
        if (sampleCount == 0) return Array.Empty<byte>();

        // 计算需要的帧数（向上取整）
        int frames = (sampleCount + FrameSize - 1) / FrameSize;
        byte[] output = new byte[frames * FrameSize * 2];
        int outputOffset = 0;

        for (int frame = 0; frame < frames; frame++)
        {
            int srcOffset = frame * FrameSize * 2;

            // 填充输入帧（不足部分补零）
            for (int i = 0; i < FrameSize; i++)
            {
                int byteIdx = srcOffset + i * 2;
                if (byteIdx + 1 < pcm16.Length)
                {
                    short s = BitConverter.ToInt16(pcm16.Slice(byteIdx, 2));
                    _inputFrame[i] = s / 32768f;
                }
                else
                {
                    _inputFrame[i] = 0f;
                }
            }

            // 复制到非托管内存
            Marshal.Copy(_inputFrame, 0, _inputPtr, FrameSize);

            // 处理
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int err = webrtc_apm_process_stream(_apm, _inputArrayPtr, _inputStreamConfig, _outputStreamConfig, _outputArrayPtr);
            sw.Stop();
            LastProcessTimeUs = sw.ElapsedTicks * 1000000 / System.Diagnostics.Stopwatch.Frequency;

            if (err != 0)
            {
                // 失败时输出静音
                Array.Clear(output, outputOffset, FrameSize * 2);
            }
            else
            {
                // 从非托管内存读取结果
                Marshal.Copy(_outputPtr, _outputFrame, 0, FrameSize);

                // float → 16-bit PCM
                for (int i = 0; i < FrameSize; i++)
                {
                    short s = (short)Math.Clamp(_outputFrame[i] * 32768f, -32768f, 32767f);
                    output[outputOffset + i * 2] = (byte)(s & 0xFF);
                    output[outputOffset + i * 2 + 1] = (byte)((s >> 8) & 0xFF);
                }
            }

            outputOffset += FrameSize * 2;
        }

        // 返回与输入等长的结果
        if (output.Length > pcm16.Length)
        {
            byte[] trimmed = new byte[pcm16.Length];
            Array.Copy(output, trimmed, pcm16.Length);
            return trimmed;
        }
        return output;
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    private void Dispose(bool disposing)
    {
        if (_disposed) return;
        _disposed = true;

        if (_inputPtr != IntPtr.Zero) Marshal.FreeHGlobal(_inputPtr);
        if (_outputPtr != IntPtr.Zero) Marshal.FreeHGlobal(_outputPtr);
        if (_inputArrayPtr != IntPtr.Zero) Marshal.FreeHGlobal(_inputArrayPtr);
        if (_outputArrayPtr != IntPtr.Zero) Marshal.FreeHGlobal(_outputArrayPtr);
        if (_inputStreamConfig != IntPtr.Zero) webrtc_apm_stream_config_destroy(_inputStreamConfig);
        if (_outputStreamConfig != IntPtr.Zero) webrtc_apm_stream_config_destroy(_outputStreamConfig);
        if (_config != IntPtr.Zero) webrtc_apm_config_destroy(_config);
        if (_apm != IntPtr.Zero) webrtc_apm_destroy(_apm);
    }

    ~WebRtcNoiseSuppressor()
    {
        Dispose(false);
    }
}
