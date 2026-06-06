using System;
using System.Collections.Generic;
using System.Diagnostics;
using Concentus.Structs;
using NAudio.Wave;

namespace VoiceChat.Audio;

/// <summary>
/// Multi-user adaptive jitter buffer with per-stream volume control.
/// Each RTP SSRC gets its own decoder, ring buffer, and jitter estimation.
/// Read() decodes one frame from each active stream, applies volume, and mixes to mono.
/// </summary>
public class AdaptiveJitterBuffer : IWaveProvider
{
    private readonly struct FrameSlot
    {
        public readonly byte[] OpusData;
        public readonly int DataLength;

        public FrameSlot(byte[] data, int length)
        {
            OpusData = data;
            DataLength = length;
        }
    }

    private const int SampleRate = 48000;
    private const int OpusChannels = 2;
    private const int FrameSize = 960;
    private const int MonoBytesPerFrame = FrameSize * 2;
    private const int MaxConsecutivePlc = 5;
    private const int NetworkLostTimeoutMs = 5000;
    private const double JitterAlpha = 0.1;
    private const int ExpectedIntervalMs = 20;

    private readonly int _minDepth;
    private readonly int _maxDepth;
    private readonly int _capacity;

    // Per-SSRC stream state
    private class StreamState
    {
        public readonly uint Ssrc;
        public readonly OpusDecoder Decoder;
        public readonly FrameSlot?[] Ring;
        public readonly short[] DecodeBuffer = new short[FrameSize * OpusChannels];
        public ushort NextSeq;
        public bool HasSeq;
        public bool Started;
        public int TargetDepth;
        public double AvgJitterMs;
        public long LastArrivalTicks;
        public int BufferedFrames;
        public int ConsecutivePlc;
        public int OverrunCount;
        public float Volume = 1.0f;

        public StreamState(uint ssrc, int capacity, int minDepth)
        {
            Ssrc = ssrc;
            Decoder = new OpusDecoder(SampleRate, OpusChannels);
            Ring = new FrameSlot?[capacity];
            TargetDepth = minDepth + 1;
        }
    }

    private readonly Dictionary<uint, StreamState> _streams = new();
    private long _lastReceiveTicks;

    private float _masterVolume = 1.0f;
    private readonly float[] _mixBuffer = new float[FrameSize];

    private readonly object _lock = new();

    // Snapshot taken under lock, used outside lock for decode
    private enum FrameMode { Silence, Normal, Plc }

    private struct FrameData
    {
        public FrameMode Mode;
        public byte[]? OpusData;
        public int DataLen;
        public float Volume;
        public OpusDecoder Decoder;
        public short[] DecodeBuffer;
    }

    public AdaptiveJitterBuffer(int minDepth = 2, int maxDepth = 10)
    {
        _minDepth = minDepth;
        _maxDepth = maxDepth;
        _capacity = maxDepth * 4;
    }

    public WaveFormat WaveFormat => new WaveFormat(SampleRate, 16, 1);

    public bool IsNetworkLost
    {
        get
        {
            if (_lastReceiveTicks == 0) return false;
            double elapsedMs = (Stopwatch.GetTimestamp() - _lastReceiveTicks) * 1000.0 / Stopwatch.Frequency;
            return elapsedMs > NetworkLostTimeoutMs;
        }
    }

    public float MasterVolume
    {
        get => _masterVolume;
        set => _masterVolume = Math.Clamp(value, 0f, 2f);
    }

    public void SetStreamVolume(uint ssrc, float volume)
    {
        lock (_lock)
        {
            if (_streams.TryGetValue(ssrc, out var stream))
                stream.Volume = Math.Clamp(volume, 0f, 2f);
        }
    }

    public float GetStreamVolume(uint ssrc)
    {
        lock (_lock)
        {
            return _streams.TryGetValue(ssrc, out var stream) ? stream.Volume : 1.0f;
        }
    }

    public void RemoveStream(uint ssrc)
    {
        lock (_lock)
        {
            _streams.Remove(ssrc);
        }
    }

    public void PushFrame(ushort seq, uint ssrc, byte[] opusData, int sourceOffset, int dataLength)
    {
        lock (_lock)
        {
            long now = Stopwatch.GetTimestamp();
            _lastReceiveTicks = now;

            if (!_streams.TryGetValue(ssrc, out var stream))
            {
                stream = new StreamState(ssrc, _capacity, _minDepth);
                _streams[ssrc] = stream;
            }

            if (stream.LastArrivalTicks == 0)
            {
                stream.LastArrivalTicks = now;
            }
            else
            {
                UpdateJitter(stream, now);
            }

            if (!stream.HasSeq)
            {
                stream.NextSeq = seq;
                stream.HasSeq = true;
                stream.BufferedFrames = 0;
            }

            if (IsBefore(seq, stream.NextSeq))
                return;

            int ahead = SequenceDistance(stream.NextSeq, seq);
            if (ahead >= _capacity)
            {
                stream.OverrunCount++;
                return;
            }

            int idx = seq % _capacity;
            if (stream.Ring[idx].HasValue && stream.Ring[idx].Value.OpusData != null)
                return;

            byte[] copy = new byte[dataLength];
            Array.Copy(opusData, sourceOffset, copy, 0, dataLength);
            stream.Ring[idx] = new FrameSlot(copy, dataLength);
            stream.BufferedFrames++;

            RecalculateTarget(stream);

            if (!stream.Started && stream.BufferedFrames >= stream.TargetDepth)
                stream.Started = true;
        }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
        int written = 0;
        while (written + MonoBytesPerFrame <= count)
        {
            // Snapshot frame data from all streams under lock
            FrameData[] frames;
            lock (_lock)
            {
                if (_streams.Count == 0)
                {
                    Array.Clear(buffer, offset + written, count - written);
                    return count;
                }

                frames = new FrameData[_streams.Count];
                int i = 0;
                foreach (var stream in _streams.Values)
                {
                    ref var fd = ref frames[i++];
                    fd.Volume = stream.Volume;
                    fd.Decoder = stream.Decoder;
                    fd.DecodeBuffer = stream.DecodeBuffer;

                    if (!stream.Started)
                    {
                        fd.Mode = FrameMode.Silence;
                        continue;
                    }

                    int idx = stream.NextSeq % _capacity;
                    var slot = stream.Ring[idx];

                    if (slot.HasValue && slot.Value.OpusData != null)
                    {
                        fd.Mode = FrameMode.Normal;
                        fd.OpusData = slot.Value.OpusData;
                        fd.DataLen = slot.Value.DataLength;
                        stream.Ring[idx] = null;
                        stream.BufferedFrames--;
                        stream.NextSeq++;
                        stream.ConsecutivePlc = 0;
                    }
                    else
                    {
                        stream.Ring[idx] = null;
                        stream.NextSeq++;

                        if (stream.ConsecutivePlc < MaxConsecutivePlc)
                        {
                            fd.Mode = FrameMode.Plc;
                            stream.ConsecutivePlc++;
                        }
                        else
                        {
                            fd.Mode = FrameMode.Silence;
                            stream.ConsecutivePlc++;
                        }
                    }
                }
            }

            // Decode and mix OUTSIDE the lock
            Array.Clear(_mixBuffer, 0, FrameSize);

            for (int i = 0; i < frames.Length; i++)
            {
                ref var fd = ref frames[i];
                float vol = fd.Volume * _masterVolume;
                if (vol < 0.001f) continue; // effectively muted, skip decode

                switch (fd.Mode)
                {
                    case FrameMode.Normal:
                        DecodeAndMix(fd.Decoder, fd.DecodeBuffer, fd.OpusData!, fd.DataLen, vol);
                        break;
                    case FrameMode.Plc:
                        PlcAndMix(fd.Decoder, fd.DecodeBuffer, vol);
                        break;
                }
            }

            ConvertFloatToPcm(_mixBuffer, buffer, offset + written, FrameSize);
            written += MonoBytesPerFrame;
        }

        if (written < count)
            Array.Clear(buffer, offset + written, count - written);

        return count;
    }

    public void Reset()
    {
        lock (_lock)
        {
            _streams.Clear();
            _lastReceiveTicks = 0;
        }
    }

    // ==================== Decode helpers ====================

    private static void DecodeAndMix(OpusDecoder decoder, short[] decodeBuffer,
        byte[] opusData, int dataLen, float volume, float[] mixBuffer)
    {
        try
        {
            int n = decoder.Decode(opusData, 0, dataLen, decodeBuffer, 0, FrameSize, false);
            for (int i = 0; i < n && i < FrameSize; i++)
                mixBuffer[i] += decodeBuffer[i * 2] / 32768f * volume;
        }
        catch { }
    }

    // Overload that uses instance _mixBuffer
    private void DecodeAndMix(OpusDecoder decoder, short[] decodeBuffer,
        byte[] opusData, int dataLen, float volume)
    {
        DecodeAndMix(decoder, decodeBuffer, opusData, dataLen, volume, _mixBuffer);
    }

    private void PlcAndMix(OpusDecoder decoder, short[] decodeBuffer, float volume)
    {
        try
        {
            int n = decoder.Decode(null, 0, 0, decodeBuffer, 0, FrameSize, false);
            for (int i = 0; i < n && i < FrameSize; i++)
                _mixBuffer[i] += decodeBuffer[i * 2] / 32768f * volume;
        }
        catch { }
    }

    private static void ConvertFloatToPcm(float[] src, byte[] dst, int dstOffset, int count)
    {
        for (int i = 0; i < count; i++)
        {
            float s = Math.Clamp(src[i], -1f, 1f);
            short pcm = (short)(s * 32767f);
            dst[dstOffset + i * 2] = (byte)(pcm & 0xFF);
            dst[dstOffset + i * 2 + 1] = (byte)((pcm >> 8) & 0xFF);
        }
    }

    // ==================== Jitter and sequence helpers ====================

    private static void UpdateJitter(StreamState stream, long nowTicks)
    {
        double elapsedMs = (nowTicks - stream.LastArrivalTicks) * 1000.0 / Stopwatch.Frequency;
        double jitter = Math.Abs(elapsedMs - ExpectedIntervalMs);

        if (stream.AvgJitterMs < 0.01)
            stream.AvgJitterMs = jitter;
        else
            stream.AvgJitterMs = stream.AvgJitterMs * (1 - JitterAlpha) + jitter * JitterAlpha;

        stream.LastArrivalTicks = nowTicks;
    }

    private void RecalculateTarget(StreamState stream)
    {
        int desired = (int)Math.Round(stream.AvgJitterMs * 2.0 / ExpectedIntervalMs);
        desired = Math.Max(_minDepth, Math.Min(_maxDepth, desired));

        if (desired > stream.TargetDepth)
            stream.TargetDepth = desired;
        else if (desired < stream.TargetDepth)
            stream.TargetDepth = Math.Max(stream.TargetDepth - 1, desired);
    }

    private static bool IsBefore(ushort a, ushort b) => (short)(a - b) < 0;
    private static int SequenceDistance(ushort from, ushort to) => (ushort)(to - from);
}
