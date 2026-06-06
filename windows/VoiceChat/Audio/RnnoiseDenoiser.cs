using System;
using System.Buffers;
using System.Runtime.InteropServices;

namespace VoiceChat.Audio;

/// <summary>
/// RNNoise 实时降噪 + 语音概率动态增益
///
/// 处理流程（每 10ms 帧）：
/// 1. rnnoise_process_frame → 降噪后的音频 + 语音概率 (0~1)
/// 2. 语音概率 → 目标增益（语音帧放大，噪声帧压低）
/// 3. 增益平滑过渡（attack/release 包络）
/// 4. 应用增益到降噪后的音频
///
/// 效果：人声明显变大，键盘/鼠标/环境噪声被压低。
/// </summary>
public sealed class RnnoiseDenoiser : IDisposable
{
    private const string DllName = "librnnoise.dll";
    private const int FrameSize = 480; // 10ms @ 48kHz

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, EntryPoint = "rnnoise_get_frame_size")]
    private static extern int _test_rnnoise_get_frame_size();

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

    // 20ms(960) → 2×10ms(480) 帧缓冲
    private readonly float[] _pending = new float[FrameSize];
    private int _pendingCount;

    // ===== 动态增益参数 =====
    // 语音帧增益（>1 放大），噪声帧增益（<1 压低）
    private const float SpeechGain = 3.0f;   // 人声放大 3 倍 (+9.5dB)
    private const float NoiseGain = 0.15f;   // 噪声压到 15% (-16dB)
    // 语音概率到增益的映射阈值
    private const float ProbLow = 0.15f;     // 低于此 = 纯噪声
    private const float ProbHigh = 0.40f;    // 高于此 = 纯语音
    // 增益平滑（每帧变化速度，防止 click 杂音）
    private const float AttackCoeff = 0.3f;  // 增益上升速度（快）
    private const float ReleaseCoeff = 0.08f; // 增益下降速度（慢，避免语音尾部被切）

    private float _currentGain = 1.0f;

    /// <summary>最近一帧的语音概率</summary>
    public float LastSpeechProb { get; private set; }
    /// <summary>最近一帧应用的增益</summary>
    public float LastAppliedGain => _currentGain;

    public RnnoiseDenoiser()
    {
        int expectedFrameSize = rnnoise_get_frame_size();
        if (expectedFrameSize != FrameSize)
            throw new InvalidOperationException($"RNNoise 帧大小不匹配：期望 {FrameSize}，实际 {expectedFrameSize}");

        _state = rnnoise_create(IntPtr.Zero);
        if (_state == IntPtr.Zero)
            throw new InvalidOperationException("RNNoise 初始化失败");
    }

    /// <summary>
    /// 处理 16-bit PCM，返回降噪 + 动态增益后的 16-bit PCM。
    /// </summary>
    public byte[] Process(ReadOnlySpan<byte> pcm16)
    {
        int sampleCount = pcm16.Length / 2;
        if (sampleCount == 0) return Array.Empty<byte>();

        float[] floatSamples = ArrayPool<float>.Shared.Rent(sampleCount);
        try
        {
            for (int i = 0; i < sampleCount; i++)
            {
                short s = BitConverter.ToInt16(pcm16.Slice(i * 2, 2));
                floatSamples[i] = s / 32768f;
            }

            var outputList = new System.Collections.Generic.List<byte>(pcm16.Length);
            int offset = 0;

            // 处理上次遗留的 pending
            if (_pendingCount > 0)
            {
                int need = FrameSize - _pendingCount;
                int take = Math.Min(need, sampleCount);
                Array.Copy(floatSamples, 0, _pending, _pendingCount, take);
                _pendingCount += take;
                offset += take;

                if (_pendingCount == FrameSize)
                {
                    ProcessOneFrame(_pending, outputList);
                    _pendingCount = 0;
                }
            }

            // 处理完整帧
            while (offset + FrameSize <= sampleCount)
            {
                Array.Copy(floatSamples, offset, _frameBuffer, 0, FrameSize);
                ProcessOneFrame(_frameBuffer, outputList);
                offset += FrameSize;
            }

            // 保存剩余
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

    private void ProcessOneFrame(float[] input, System.Collections.Generic.List<byte> output)
    {
        // 1. RNNoise 降噪，获取语音概率
        float prob = rnnoise_process_frame(_state, _outputBuffer, input);
        LastSpeechProb = prob;

        // 2. 计算目标增益：语音概率 → 线性插值
        float targetGain;
        if (prob >= ProbHigh)
            targetGain = SpeechGain;
        else if (prob <= ProbLow)
            targetGain = NoiseGain;
        else
        {
            float t = (prob - ProbLow) / (ProbHigh - ProbLow);
            targetGain = NoiseGain + (SpeechGain - NoiseGain) * t;
        }

        // 3. 平滑过渡（attack/release 包络）
        float coeff = targetGain > _currentGain ? AttackCoeff : ReleaseCoeff;
        _currentGain += (targetGain - _currentGain) * coeff;

        // 4. 应用增益
        if (Math.Abs(_currentGain - 1.0f) > 0.01f)
        {
            for (int i = 0; i < FrameSize; i++)
                _outputBuffer[i] *= _currentGain;
        }

        AppendFloatToPcm16(_outputBuffer, output);
    }

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
