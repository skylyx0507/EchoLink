using System;
using System.Buffers;
using System.Runtime.InteropServices;

namespace VoiceChat.Audio;

/// <summary>
/// RNNoise 实时降噪封装（Phase 2）
/// 
/// RNNoise 参数：
/// - 采样率：48kHz（原生支持，无需重采样）
/// - 帧大小：480 采样点 = 10ms
/// - 输入格式：float [-1.0, 1.0]，单声道
/// - 输出格式：float [-1.0, 1.0]，单声道
/// 
/// 当前项目使用 20ms 帧（960 采样点），内部自动拆分为 2×10ms 处理。
/// </summary>
public sealed class RnnoiseDenoiser : IDisposable
{
    private const string DllName = "librnnoise.dll";
    private const int FrameSize = 480; // 10ms @ 48kHz

    // 预加载测试：用于在构造前检测 DLL 是否可用
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, EntryPoint = "rnnoise_get_frame_size")]
    private static extern int _test_rnnoise_get_frame_size();

    /// <summary>
    /// 检测 librnnoise.dll 是否可用（在构造实例前调用）
    /// </summary>
    public static bool IsAvailable
    {
        get
        {
            try { return _test_rnnoise_get_frame_size() == FrameSize; }
            catch { return false; }
        }
    }

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr rnnoise_create(IntPtr model);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void rnnoise_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern float rnnoise_process_frame(IntPtr st, float[] outData, float[] inData);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern int rnnoise_get_frame_size();

    private IntPtr _state;
    private readonly float[] _frameBuffer = new float[FrameSize];
    private readonly float[] _outputBuffer = new float[FrameSize];

    // 用于处理 20ms(960采样点) → 2×10ms(480采样点)
    private readonly float[] _pending = new float[FrameSize];
    private int _pendingCount = 0;

    public RnnoiseDenoiser()
    {
        int expectedFrameSize = rnnoise_get_frame_size();
        if (expectedFrameSize != FrameSize)
            throw new InvalidOperationException($"RNNoise 帧大小不匹配：期望 {FrameSize}，实际 {expectedFrameSize}");

        _state = rnnoise_create(IntPtr.Zero); // 使用内置模型
        if (_state == IntPtr.Zero)
            throw new InvalidOperationException("RNNoise 初始化失败");
    }

    /// <summary>
    /// 处理 16-bit PCM 数据，返回降噪后的 16-bit PCM。
    /// 输入长度任意，输出长度与输入长度相同（内部缓冲处理）。
    /// </summary>
    public byte[] Process(ReadOnlySpan<byte> pcm16)
    {
        int sampleCount = pcm16.Length / 2;
        if (sampleCount == 0) return Array.Empty<byte>();

        // 租用缓冲区避免频繁分配
        float[] floatSamples = ArrayPool<float>.Shared.Rent(sampleCount);
        try
        {
            // int16 → float [-1, 1]
            for (int i = 0; i < sampleCount; i++)
            {
                short s = BitConverter.ToInt16(pcm16.Slice(i * 2, 2));
                floatSamples[i] = s / 32768f;
            }

            var outputList = new System.Collections.Generic.List<byte>(pcm16.Length);
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
                    AppendFloatToPcm16(_outputBuffer, outputList);
                    _pendingCount = 0;
                }
            }

            // 处理完整的 480 采样点帧
            while (offset + FrameSize <= sampleCount)
            {
                Array.Copy(floatSamples, offset, _frameBuffer, 0, FrameSize);
                rnnoise_process_frame(_state, _outputBuffer, _frameBuffer);
                AppendFloatToPcm16(_outputBuffer, outputList);
                offset += FrameSize;
            }

            // 保存剩余的采样点到 pending
            int remaining = sampleCount - offset;
            if (remaining > 0)
            {
                Array.Copy(floatSamples, offset, _pending, 0, remaining);
                _pendingCount = remaining;
            }

            return outputList.ToArray();
        }
        finally
        {
            ArrayPool<float>.Shared.Return(floatSamples);
        }
    }

    /// <summary>
    /// 刷新剩余数据（用静音填充最后一帧）。
    /// 在麦克风关闭前调用，避免丢失 pending 中的音频。
    /// </summary>
    public byte[] Flush()
    {
        if (_pendingCount == 0) return Array.Empty<byte>();

        Array.Clear(_pending, _pendingCount, FrameSize - _pendingCount);
        rnnoise_process_frame(_state, _outputBuffer, _pending);

        var result = new byte[FrameSize * 2];
        for (int i = 0; i < FrameSize; i++)
        {
            short s = (short)Math.Clamp(_outputBuffer[i] * 32768f, short.MinValue, short.MaxValue);
            result[i * 2] = (byte)(s & 0xFF);
            result[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
        _pendingCount = 0;
        return result;
    }

    private static void AppendFloatToPcm16(float[] data, System.Collections.Generic.List<byte> output)
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
