using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Concentus.Enums;
using Concentus.Structs;
using NAudio.Wave;
using VoiceChat.Audio;
using WebSocketSharp;

namespace VoiceChat;

public partial class MainWindow : Window
{
    // ==================== 网络 ====================
    private WebSocket? _ws;
    private string _serverUrl = "";
    private string _roomId = "";
    private string _peerId = "";

    // ==================== mediasoup ====================
    private string? _sendTransportId;
    private string? _recvTransportId;
    private string? _producerId;

    // ==================== RTP ====================
    private UdpClient? _udpClient;
    private IPEndPoint? _serverSendEndPoint;
    private CancellationTokenSource? _recvCts;

    // ==================== Opus ====================
    private OpusEncoder? _opusEncoder;
    private OpusDecoder? _opusDecoder;

    // ==================== 音频 ====================
    private WaveInEvent? _micCapture;
    private WaveOutEvent? _audioOutput;
    private AdaptiveJitterBuffer? _jitterBuffer;
    private int _selectedMicDevice = -1; // -1 = 系统默认
    private int _selectedSpeakerDevice = -1; // -1 = 系统默认

    // 设备信息类（用于 ComboBox 绑定）
    private class DeviceItem
    {
        public string ProductName { get; set; } = "";
        public int DeviceNumber { get; set; }
        public override string ToString() => ProductName;
    }

    // ==================== RTP 状态 ====================
    private ushort _sendSeq;
    private uint _sendTimestamp;
    private uint _sendSsrc;

    // ==================== 成员 ====================
    private record PeerInfo(string PeerId, bool MicEnabled);
    private readonly Dictionary<string, PeerInfo> _peers = new();

    // ==================== 音量控制 ====================
    private float _masterVolume = 1.0f;
    private float _micVolume = 1.0f;
    private readonly Dictionary<uint, string> _ssrcToPeerId = new();

    public void SetMasterVolume(float volume)
    {
        _masterVolume = Math.Clamp(volume, 0f, 2f);
        if (_jitterBuffer != null) _jitterBuffer.MasterVolume = _masterVolume;
    }

    public void SetMicVolume(float volume)
    {
        _micVolume = Math.Clamp(volume, 0f, 2f);
    }

    public void SetPeerVolume(string peerId, float volume)
    {
        foreach (var (ssrc, pid) in _ssrcToPeerId)
        {
            if (pid == peerId)
            {
                _jitterBuffer?.SetStreamVolume(ssrc, volume);
                break;
            }
        }
    }

    // ==================== 消息等待 ====================
    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pendingMessages = new();

    // ==================== 状态 ====================
    private bool _micEnabled;
    private bool _isSpeaking;

    // ==================== 降噪（Phase 2: RNNoise AI 降噪 + Phase 1 门限兜底）====================
    private RnnoiseDenoiser? _rnnoiseDenoiser;   // RNNoise 实例（中/高档位使用）
    private float _vadThreshold = 0.03f;          // 语音检测阈值
    private float _noiseGateThreshold = 0.015f;   // Phase 1 噪声门限（低档位使用）
    private bool _noiseGateEnabled = true;        // 是否启用 Phase 1 噪声门限
    private bool _rnnoiseEnabled = false;        // 是否启用 RNNoise

    // 音频参数
    private const int SampleRate = 48000;
    private const int OpusChannels = 2; // mediasoup 要求 Opus 2 通道
    private const int FrameSize = 960; // 20ms @ 48kHz

    public MainWindow(string serverUrl, string roomId, string peerId, string theme)
    {
        InitializeComponent();
        _serverUrl = serverUrl;
        _roomId = roomId;
        _peerId = peerId;
        ApplyTheme(theme);
        Loaded += async (_, _) =>
        {
            try
            {
                await JoinRoomAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] JoinRoomAsync failed: {ex.GetType().Name}: {ex.Message}");
                Console.WriteLine($"[ERROR] StackTrace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"[ERROR] InnerException: {ex.InnerException.GetType().Name}: {ex.InnerException.Message}");
                    Console.WriteLine($"[ERROR] Inner StackTrace: {ex.InnerException.StackTrace}");
                }
                MessageBox.Show($"加入房间失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                // 回到登录窗口
                var login = new LoginWindow();
                login.Show();
                Close();
            }
        };
    }

    private void ApplyTheme(string theme)
    {
        var colors = new Dictionary<string, (string bg, string bgSecondary, string bgCard, string bgInput, string bgHover, string primary, string success, string danger)>
        {
            ["dark"] = ("#1e1f22", "#2b2d31", "#313338", "#383a40", "#404249", "#5865f2", "#23a559", "#f23f43"),
            ["light"] = ("#f2f3f5", "#e3e5e8", "#ffffff", "#ebedef", "#d4d7dc", "#5865f2", "#23a559", "#f23f43"),
            ["purple"] = ("#1a1025", "#241830", "#2d1f3d", "#362850", "#3f305e", "#9b59b6", "#2ecc71", "#e74c3c"),
            ["ocean"] = ("#0a1628", "#0f2035", "#142a42", "#1a3350", "#1f3d5e", "#0088cc", "#00b894", "#e17055"),
            ["sunset"] = ("#1a0f0a", "#2d1a0f", "#3d2518", "#4d2f1f", "#5d3a28", "#e67e22", "#27ae60", "#c0392b"),
        };

        if (!colors.TryGetValue(theme, out var c)) return;

        TryFindAndSet("BgBrush", c.bg);
        TryFindAndSet("BgSecondaryBrush", c.bgSecondary);
        TryFindAndSet("BgCardBrush", c.bgCard);
        TryFindAndSet("BgInputBrush", c.bgInput);
        TryFindAndSet("BgHoverBrush", c.bgHover);
        TryFindAndSet("PrimaryBrush", c.primary);
        TryFindAndSet("PrimaryHoverBrush", c.primary);
        TryFindAndSet("SuccessBrush", c.success);
        TryFindAndSet("DangerBrush", c.danger);
        TryFindAndSet("TextBrush", theme == "light" ? "#1e1f22" : "#f2f3f5");
        TryFindAndSet("TextMutedBrush", theme == "light" ? "#6b7280" : "#949ba4");
        TryFindAndSet("TextSecondaryBrush", theme == "light" ? "#4b5563" : "#b5bac1");
        TryFindAndSet("BorderBrush", theme == "light" ? "#d4d7dc" : "#3f4147");
    }

    private void TryFindAndSet(string key, string color)
    {
        Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
    }

    // ==================== UI 事件 ====================

    private void LeaveBtn_Click(object sender, RoutedEventArgs e) => LeaveRoom();

    private void MicBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_micEnabled)
            DisableMic();
        else
            EnableMic();
    }

    private void NoiseLevel_Click(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton btn && btn.Tag is string tag)
        {
            switch (tag)
            {
                case "off":
                    _vadThreshold = 0.00f;
                    _noiseGateThreshold = 0.00f;
                    _noiseGateEnabled = false;
                    _rnnoiseEnabled = false;
                    break;
                case "low":
                    _vadThreshold = 0.03f;
                    _noiseGateThreshold = 0.015f;
                    _noiseGateEnabled = true;
                    _rnnoiseEnabled = false;
                    break;
                case "medium":
                    _vadThreshold = 0.05f;
                    _noiseGateThreshold = 0.00f;
                    _noiseGateEnabled = false;
                    _rnnoiseEnabled = true;
                    break;
                case "high":
                    _vadThreshold = 0.10f;
                    _noiseGateThreshold = 0.00f;
                    _noiseGateEnabled = false;
                    _rnnoiseEnabled = true;
                    break;
            }

            // 如果正在通话，动态切换降噪实例
            if (_micEnabled)
            {
                if (_rnnoiseEnabled && _rnnoiseDenoiser == null && RnnoiseDenoiser.IsAvailable)
                {
                    try { _rnnoiseDenoiser = new RnnoiseDenoiser(); }
                    catch { /* RNNoise DLL 加载失败时静默失败 */ }
                }
                else if (!_rnnoiseEnabled || (_rnnoiseEnabled && !RnnoiseDenoiser.IsAvailable))
                {
                    _rnnoiseDenoiser?.Dispose();
                    _rnnoiseDenoiser = null;
                }
            }
        }
    }

    // 音频设备选择
    private void MicDeviceCombo_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (MicDeviceCombo.SelectedItem is DeviceItem item)
            _selectedMicDevice = item.DeviceNumber;
    }

    private void SpeakerDeviceCombo_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (SpeakerDeviceCombo.SelectedItem is DeviceItem item)
            _selectedSpeakerDevice = item.DeviceNumber;
    }

    // 音量控制
    private void MasterVolumeSlider_Changed(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        SetMasterVolume((float)(e.NewValue / 100.0));
    }

    private void MicVolumeSlider_Changed(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        SetMicVolume((float)(e.NewValue / 100.0));
    }

    // ==================== 音频设备枚举 ====================

    private void LoadAudioDevices()
    {
        // 麦克风设备
        var micDevices = new List<DeviceItem> { new() { ProductName = "默认麦克风", DeviceNumber = -1 } };
        for (int i = 0; i < WaveInEvent.DeviceCount; i++)
        {
            var caps = WaveInEvent.GetCapabilities(i);
            micDevices.Add(new DeviceItem { ProductName = caps.ProductName, DeviceNumber = i });
        }
        MicDeviceCombo.ItemsSource = micDevices;
        MicDeviceCombo.SelectedIndex = 0;

        // 扬声器设备（WaveOut 和 WaveOutEvent 共享设备列表）
        var speakerDevices = new List<DeviceItem> { new() { ProductName = "默认扬声器", DeviceNumber = -1 } };
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            var caps = WaveOut.GetCapabilities(i);
            speakerDevices.Add(new DeviceItem { ProductName = caps.ProductName, DeviceNumber = i });
        }
        SpeakerDeviceCombo.ItemsSource = speakerDevices;
        SpeakerDeviceCombo.SelectedIndex = 0;
    }

    // ==================== 房间管理 ====================

    private async Task JoinRoomAsync()
    {
        // 1. 初始化 Opus
        _opusEncoder = new OpusEncoder(SampleRate, OpusChannels, OpusApplication.OPUS_APPLICATION_VOIP);
        _opusEncoder.Bitrate = 64000;
        _opusEncoder.UseInbandFEC = true;
        _opusDecoder = new OpusDecoder(SampleRate, OpusChannels);

        // 2. 初始化 UDP（收发共用同一个端口）
        _udpClient = new UdpClient(0);

        // 3. 连接 WebSocket
        _ws = new WebSocket(_serverUrl);
        _ws.OnMessage += (_, evt) => Dispatcher.BeginInvoke(() => HandleMessage(evt.Data));
        _ws.OnError += (_, evt) => Dispatcher.BeginInvoke(() => MessageBox.Show("连接失败: " + evt.Message, "错误", MessageBoxButton.OK, MessageBoxImage.Error));
        _ws.OnClose += (_, _) => Dispatcher.BeginInvoke(() => LeaveRoom());
        _ws.Connect();

        if (_ws.ReadyState != WebSocketState.Open)
            throw new Exception("无法连接到服务器");

        // 4. 加入房间
        SendMessage(new { type = "joinRoom", roomId = _roomId, peerId = _peerId });
        var joined = await WaitForMessage("joinedRoom");

        // 5. 创建发送 PlainTransport
        SendMessage(new { type = "createPlainTransport", direction = "send" });
        var sendCreated = await WaitForMessage("plainTransportCreated");
        _sendTransportId = sendCreated.GetProperty("id").GetString();
        var sendIp = sendCreated.GetProperty("ip").GetString()!;
        var sendPort = sendCreated.GetProperty("port").GetInt32();
        _serverSendEndPoint = new IPEndPoint(IPAddress.Parse(sendIp), sendPort);

        // 6. 创建接收 PlainTransport（只创建一次，后续复用）
        SendMessage(new { type = "createPlainTransport", direction = "recv" });
        var recvCreated = await WaitForMessage("plainTransportCreated");
        _recvTransportId = recvCreated.GetProperty("id").GetString()!;
        var recvIp = recvCreated.GetProperty("ip").GetString()!;
        var recvPort = recvCreated.GetProperty("port").GetInt32();

        // 7. 发送空 RTP 到接收 transport 触发 comedia 检测
        var recvEndPoint = new IPEndPoint(IPAddress.Parse(recvIp), recvPort);
        byte[] dummyRtp = new byte[12];
        dummyRtp[0] = 0x80;
        dummyRtp[1] = 0x6F;
        _udpClient.Send(dummyRtp, dummyRtp.Length, recvEndPoint);

        // 8. 启动接收
        StartRtpReceiver();

        // 9. 初始化 UI
        LoadAudioDevices();
        RoomNameText.Text = _roomId;
        ControlUserName.Text = _peerId;
        OnlineCountRun.Text = "1";
        MembersPanel.Children.Clear();
        MembersPanel.Children.Add(CreateMemberCard(_peerId, false, true));

        // 10. 添加已有成员（包括未开麦的）
        if (joined.TryGetProperty("existingPeers", out var existingPeers))
        {
            foreach (var ep in existingPeers.EnumerateArray())
            {
                var epId = ep.GetString()!;
                if (!_peers.ContainsKey(epId))
                {
                    _peers[epId] = new PeerInfo(epId, false);
                    MembersPanel.Children.Add(CreateMemberCard(epId, false, false));
                }
            }
            UpdateOnlineCount();
        }

        // 11. 消费已有 producers
        if (joined.TryGetProperty("existingProducers", out var producers))
        {
            foreach (var p in producers.EnumerateArray())
            {
                await ConsumeRemoteAsync(
                    p.GetProperty("producerId").GetString()!,
                    p.GetProperty("peerId").GetString()!);
            }
        }
    }

    private void LeaveRoom()
    {
        DisableMic();
        _recvCts?.Cancel();
        _udpClient?.Dispose(); _udpClient = null;
        _audioOutput?.Stop(); _audioOutput?.Dispose(); _audioOutput = null;
        _jitterBuffer = null;
        _opusEncoder?.Dispose(); _opusEncoder = null;
        _opusDecoder?.Dispose(); _opusDecoder = null;

        SendMessage(new { type = "leaveRoom" });
        _ws?.Close(); _ws = null;
        _sendTransportId = null; _recvTransportId = null; _producerId = null; _serverSendEndPoint = null;
        _peers.Clear(); MembersPanel.Children.Clear(); _pendingMessages.Clear();

        // 回到登录窗口
        Dispatcher.BeginInvoke(() =>
        {
            var login = new LoginWindow();
            login.Show();
            Close();
        });
    }

    // ==================== WebSocket ====================

    private void SendMessage(object msg)
    {
        if (_ws?.ReadyState == WebSocketState.Open)
            _ws.Send(JsonSerializer.Serialize(msg));
    }

    private Task<JsonElement> WaitForMessage(string type, int timeoutMs = 10000)
    {
        var tcs = new TaskCompletionSource<JsonElement>();
        _pendingMessages[type] = tcs;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(timeoutMs) };
        timer.Tick += (_, _) => { timer.Stop(); if (_pendingMessages.Remove(type)) tcs.TrySetException(new TimeoutException($"等待 {type} 超时")); };
        timer.Start();
        return tcs.Task;
    }

    private void HandleMessage(string data)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(data); } catch { return; }
        var msg = doc.RootElement;
        var type = msg.GetProperty("type").GetString();

        if (type != null && _pendingMessages.TryGetValue(type, out var tcs))
        {
            _pendingMessages.Remove(type);
            tcs.TrySetResult(msg);
            return;
        }

        switch (type)
        {
            case "newProducer":
                _ = ConsumeRemoteAsync(msg.GetProperty("producerId").GetString()!, msg.GetProperty("peerId").GetString()!);
                break;
            case "producerClosed":
                var pid = msg.GetProperty("peerId").GetString()!;
                if (_peers.TryGetValue(pid, out var p)) { _peers[pid] = p with { MicEnabled = false }; Dispatcher.BeginInvoke(() => UpdateMemberCard(pid, false)); }
                break;
            case "peerJoined":
                var pj = msg.GetProperty("peerId").GetString()!;
                if (!_peers.ContainsKey(pj)) { _peers[pj] = new PeerInfo(pj, false); Dispatcher.BeginInvoke(() => { MembersPanel.Children.Add(CreateMemberCard(pj, false, false)); UpdateOnlineCount(); }); }
                break;
            case "peerLeft":
                var pl = msg.GetProperty("peerId").GetString()!;
                _peers.Remove(pl);
                Dispatcher.BeginInvoke(() => { RemoveMemberCard(pl); UpdateOnlineCount(); });
                break;
            case "error":
                var errMsg = msg.GetProperty("message").GetString() ?? "未知错误";
                Console.WriteLine($"[ERROR] Server error: {errMsg}");
                Dispatcher.BeginInvoke(() => MessageBox.Show(errMsg, "服务器错误", MessageBoxButton.OK, MessageBoxImage.Warning));
                break;
        }
    }

    // ==================== 消费远程音频 ====================

    private async Task ConsumeRemoteAsync(string producerId, string peerId)
    {
        // 复用 JoinRoom 时创建的 recv PlainTransport，直接请求消费
        SendMessage(new { type = "consume", producerId, rtpCapabilities = GetRtpCapabilities() });
        var msg = await WaitForMessage("consumed");
        var consumerId = msg.GetProperty("consumerId").GetString()!;
        SendMessage(new { type = "resumeConsuming", consumerId });

        // 提取 SSRC 用于 per-peer 音量控制
        try
        {
            if (msg.TryGetProperty("rtpParameters", out var rtpParams) &&
                rtpParams.TryGetProperty("encodings", out var encodings) &&
                encodings.GetArrayLength() > 0)
            {
                uint ssrc = encodings[0].GetProperty("ssrc").GetUInt32();
                _ssrcToPeerId[ssrc] = peerId;
            }
        }
        catch { }

        // 更新对端
        if (!_peers.ContainsKey(peerId))
        {
            _peers[peerId] = new PeerInfo(peerId, true);
            Dispatcher.BeginInvoke(() => { MembersPanel.Children.Add(CreateMemberCard(peerId, true, false)); UpdateOnlineCount(); });
        }
        else
        {
            _peers[peerId] = _peers[peerId] with { MicEnabled = true };
            Dispatcher.BeginInvoke(() => UpdateMemberCard(peerId, true));
        }
    }

    // ==================== RTP 收发 ====================

    private void StartRtpReceiver()
    {
        _jitterBuffer = new AdaptiveJitterBuffer(minDepth: 2, maxDepth: 10);
        _audioOutput = new WaveOutEvent
        {
            DeviceNumber = _selectedSpeakerDevice >= 0 ? _selectedSpeakerDevice : 0
        };
        _audioOutput.Init(_jitterBuffer);
        _audioOutput.Play();

        _recvCts = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            while (!_recvCts.IsCancellationRequested)
            {
                try
                {
                    var result = await _udpClient!.ReceiveAsync();
                    ProcessIncomingRtp(result.Buffer);
                }
                catch (ObjectDisposedException) { break; }
                catch { }
            }
        });
    }

    private void ProcessIncomingRtp(byte[] packet)
    {
        if (packet.Length < 12 || _jitterBuffer == null) return;
        try
        {
            // Extract RTP sequence number (bytes 2-3) and SSRC (bytes 8-11)
            ushort seq = (ushort)((packet[2] << 8) | packet[3]);
            uint ssrc = (uint)((packet[8] << 24) | (packet[9] << 16) | (packet[10] << 8) | packet[11]);

            int cc = packet[0] & 0x0F;
            bool ext = (packet[0] & 0x10) != 0;
            int offset = 12 + cc * 4;
            if (ext && offset + 4 <= packet.Length)
                offset += (packet[offset + 2] << 8 | packet[offset + 3]) * 4 + 4;

            int len = packet.Length - offset;
            if (len <= 0) return;

            // Feed encoded Opus frame to jitter buffer (decoding happens on playback thread)
            _jitterBuffer.PushFrame(seq, ssrc, packet, offset, len);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ERROR] ProcessIncomingRtp failed: {ex.GetType().Name}: {ex.Message}");
        }
    }

    private void SendRtpAudio(byte[] pcmData)
    {
        if (_udpClient == null || _serverSendEndPoint == null || _opusEncoder == null) return;
        try
        {
            int count = pcmData.Length / 2; // mono sample count
            for (int off = 0; off + FrameSize <= count; off += FrameSize)
            {
                // 单声道 → 双声道（复制 L→R）
                short[] frame = new short[FrameSize * OpusChannels];
                for (int i = 0; i < FrameSize; i++)
                {
                    short sample = BitConverter.ToInt16(pcmData, (off + i) * 2);
                    frame[i * 2] = sample;     // L
                    frame[i * 2 + 1] = sample; // R
                }

                byte[] opus = new byte[4000];
                int enc = _opusEncoder.Encode(frame, 0, FrameSize, opus, 0, opus.Length);
                if (enc <= 0) continue;

                byte[] rtp = new byte[12 + enc];
                rtp[0] = 0x80; rtp[1] = 0x6F;
                rtp[2] = (byte)(_sendSeq >> 8); rtp[3] = (byte)(_sendSeq & 0xFF);
                rtp[4] = (byte)(_sendTimestamp >> 24); rtp[5] = (byte)((_sendTimestamp >> 16) & 0xFF);
                rtp[6] = (byte)((_sendTimestamp >> 8) & 0xFF); rtp[7] = (byte)(_sendTimestamp & 0xFF);
                rtp[8] = (byte)(_sendSsrc >> 24); rtp[9] = (byte)((_sendSsrc >> 16) & 0xFF);
                rtp[10] = (byte)((_sendSsrc >> 8) & 0xFF); rtp[11] = (byte)(_sendSsrc & 0xFF);
                Array.Copy(opus, 0, rtp, 12, enc);

                _udpClient.Send(rtp, rtp.Length, _serverSendEndPoint);
                _sendSeq++;
                _sendTimestamp += (uint)FrameSize;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ERROR] SendRtpAudio failed: {ex.GetType().Name}: {ex.Message}");
        }
    }

    // ==================== 麦克风 ====================

    private void EnableMic()
    {
        try
        {
            _micCapture = new WaveInEvent
            {
                WaveFormat = new WaveFormat(SampleRate, 16, 1),
                BufferMilliseconds = 20,
                DeviceNumber = _selectedMicDevice >= 0 ? _selectedMicDevice : 0
            };
            _micCapture.DataAvailable += OnMicDataAvailable;
            _micCapture.StartRecording();

            // 先更新 UI 状态
            _micEnabled = true;
            ControlUserState.Text = "麦克风已开";
            UpdateMicButton(true);

            // 根据当前降噪档位初始化 RNNoise
            if (_rnnoiseEnabled && RnnoiseDenoiser.IsAvailable)
            {
                try { _rnnoiseDenoiser = new RnnoiseDenoiser(); }
                catch
                {
                    // RNNoise DLL 加载失败时回退到 Phase 1
                    _rnnoiseEnabled = false;
                    _noiseGateEnabled = true;
                    _noiseGateThreshold = 0.025f;
                }
            }
            else if (_rnnoiseEnabled && !RnnoiseDenoiser.IsAvailable)
            {
                // DLL 不存在，中/高档位自动降级为 Phase 1 门限
                _rnnoiseEnabled = false;
                _noiseGateEnabled = true;
                _noiseGateThreshold = 0.025f;
            }

            // 每次开麦生成新 SSRC，避免与旧 producer 冲突
            _sendSsrc = 1000000000u + (uint)new Random().Next(0, 2000000000);

            // 发送 produce 请求
            SendMessage(new { type = "produce", kind = "audio", rtpParameters = BuildRtpParameters() });
            _ = WaitForMessage("produced").ContinueWith(t =>
            {
                Dispatcher.BeginInvoke(() =>
                {
                    if (t.IsCompletedSuccessfully)
                    {
                        _producerId = t.Result.GetProperty("producerId").GetString();
                    }
                    else
                    {
                        var err = t.Exception?.InnerException?.Message ?? "未知错误";
                        Console.WriteLine($"[ERROR] produce failed: {err}");
                        MessageBox.Show("produce 失败: " + err, "错误", MessageBoxButton.OK, MessageBoxImage.Error);
                        DisableMic();
                    }
                });
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ERROR] EnableMic failed: {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"[ERROR] StackTrace: {ex.StackTrace}");
            MessageBox.Show($"麦克风开启失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void DisableMic()
    {
        if (_micCapture != null)
        {
            _micCapture.StopRecording();
            _micCapture.DataAvailable -= OnMicDataAvailable;
            _micCapture.Dispose();
            _micCapture = null;
        }

        // 通知服务器关闭 producer，释放 SSRC
        if (_producerId != null)
        {
            SendMessage(new { type = "closeProducer", producerId = _producerId });
            _producerId = null;
        }

        _micEnabled = false;
        _rnnoiseDenoiser?.Dispose();
        _rnnoiseDenoiser = null;
        ControlUserState.Text = "麦克风已关";
        UpdateMicButton(false);
        SetSpeaking(false);
    }

    private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (!_micEnabled) return;

        // 计算当前帧的音量峰值（用于 VAD）
        float max = 0;
        for (int i = 0; i < e.BytesRecorded; i += 2)
        {
            float lvl = Math.Abs(BitConverter.ToInt16(e.Buffer, i) / 32768f);
            if (lvl > max) max = lvl;
        }
        Dispatcher.BeginInvoke(() => SetSpeaking(max > _vadThreshold));

        // 复制音频数据，准备处理
        byte[] pcm = new byte[e.BytesRecorded];
        Array.Copy(e.Buffer, pcm, e.BytesRecorded);

        // Phase 2 降噪：RNNoise AI 降噪（中/高档位）
        if (_rnnoiseEnabled && _rnnoiseDenoiser != null)
        {
            try
            {
                pcm = _rnnoiseDenoiser.Process(pcm);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] RNNoise.Process failed: {ex.GetType().Name}: {ex.Message}");
            }
        }
        // Phase 1 兜底：简单噪声门限（低档位，或 RNNoise 未就绪时）
        else if (_noiseGateEnabled && max < _noiseGateThreshold * 3)
        {
            for (int i = 0; i < pcm.Length; i += 2)
            {
                short sample = BitConverter.ToInt16(pcm, i);
                float normalized = Math.Abs(sample / 32768f);
                if (normalized < _noiseGateThreshold)
                {
                    // 静音噪声底噪
                    pcm[i] = 0;
                    pcm[i + 1] = 0;
                }
                else
                {
                    // 渐进衰减：越接近门限衰减越多
                    float ratio = (normalized - _noiseGateThreshold) / (_noiseGateThreshold * 2);
                    ratio = Math.Clamp(ratio, 0.1f, 1.0f);
                    sample = (short)(sample * ratio);
                    pcm[i] = (byte)(sample & 0xFF);
                    pcm[i + 1] = (byte)((sample >> 8) & 0xFF);
                }
            }
        }

        // 麦克风音量增益
        if (Math.Abs(_micVolume - 1.0f) > 0.01f)
        {
            for (int i = 0; i < pcm.Length; i += 2)
            {
                short sample = BitConverter.ToInt16(pcm, i);
                float gained = sample * _micVolume;
                short clamped = (short)Math.Clamp(gained, -32768f, 32767f);
                pcm[i] = (byte)(clamped & 0xFF);
                pcm[i + 1] = (byte)((clamped >> 8) & 0xFF);
            }
        }

        SendRtpAudio(pcm);
    }

    // ==================== 说话动画 ====================

    private void SetSpeaking(bool speaking)
    {
        if (_isSpeaking == speaking) return;
        _isSpeaking = speaking;
        if (SpeakingRing == null) return;

        if (speaking)
        {
            SpeakingRing.Opacity = 1;
            ((Storyboard)FindResource("SpeakingStoryboard")).Begin();
            if (SpeakingOuterRing != null)
            {
                SpeakingOuterRing.Opacity = 1;
                ((Storyboard)FindResource("SpeakingOuterRingStoryboard")).Begin();
            }
        }
        else
        {
            SpeakingRing.Opacity = 0;
            ((Storyboard)FindResource("SpeakingStoryboard")).Stop();
            if (SpeakingOuterRing != null)
            {
                SpeakingOuterRing.Opacity = 0;
                ((Storyboard)FindResource("SpeakingOuterRingStoryboard")).Stop();
            }
        }
    }

    // ==================== RTP 参数 ====================

    private object BuildRtpParameters() => new
    {
        mid = "0",
        codecs = new[] { new { mimeType = "audio/opus", payloadType = 111, clockRate = 48000, channels = 2, parameters = new { useinbandfec = 1 } } },
        headerExtensions = new[] { new { id = 1, uri = "urn:ietf:params:rtp-hdrext:ssrc-audio-level" } },
        encodings = new[] { new { ssrc = _sendSsrc } },
        rtcp = new { cname = $"echolink-{Guid.NewGuid():N}", ssrc = _sendSsrc }
    };

    private object GetRtpCapabilities() => new
    {
        codecs = new[] { new { kind = "audio", mimeType = "audio/opus", clockRate = 48000, channels = 2, parameters = new { useinbandfec = 1 }, rtcpFeedback = Array.Empty<object>() } },
        headerExtensions = new[] { new { kind = "audio", uri = "urn:ietf:params:rtp-hdrext:sdes:mid", preferredId = 1, preferredEncrypt = false, direction = "sendrecv" } }
    };

    // ==================== UI ====================

    private Border CreateMemberCard(string peerId, bool micEnabled, bool isSelf)
    {
        var initial = peerId.Length > 0 ? peerId[0].ToString().ToUpper() : "?";
        var border = new Border { Tag = peerId, Width = 140, CornerRadius = new CornerRadius(16), Padding = new Thickness(12, 20, 12, 12), Cursor = System.Windows.Input.Cursors.Hand, Background = Brushes.Transparent, BorderBrush = new SolidColorBrush(Color.FromArgb(30, 148, 163, 184)), BorderThickness = new Thickness(1) };
        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        var avatarGrid = new Grid { Width = 72, Height = 72, Margin = new Thickness(0, 0, 0, 10) };

        avatarGrid.Children.Add(new Ellipse { Name = "MemberAvatar", Width = 64, Height = 64, Fill = isSelf ? (Brush)FindResource("AvatarSelfBrush") : micEnabled ? (Brush)FindResource("AvatarOtherBrush") : (Brush)FindResource("AvatarMutedBrush") });
        avatarGrid.Children.Add(new Ellipse { Name = "SpeakingRing", Width = 70, Height = 70, Stroke = (Brush)FindResource("SuccessBrush"), StrokeThickness = 2.5, Opacity = 0, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new ScaleTransform(1, 1) });
        avatarGrid.Children.Add(new Ellipse { Name = "SpeakingOuterRing", Width = 76, Height = 76, Stroke = (Brush)FindResource("SuccessBrush"), StrokeThickness = 1.5, Opacity = 0, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new ScaleTransform(1, 1) });
        avatarGrid.Children.Add(new TextBlock { Text = initial, FontSize = 26, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });

        stack.Children.Add(avatarGrid);
        stack.Children.Add(new TextBlock { Text = peerId, FontSize = 14, FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource("TextBrush"), HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 120 });
        stack.Children.Add(new Ellipse { Name = "StatusDot", Width = 14, Height = 14, Fill = micEnabled ? (Brush)FindResource("SuccessBrush") : (Brush)FindResource("DangerBrush"), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) });

        // Per-peer 音量滑块（不显示自己的）
        if (!isSelf)
        {
            var volSlider = new Slider
            {
                Name = "PeerVolumeSlider",
                Width = 100,
                Minimum = 0,
                Maximum = 200,
                Value = 100,
                TickFrequency = 50,
                IsSnapToTickEnabled = false,
                Margin = new Thickness(0, 6, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Center,
                ToolTip = $"{peerId} 音量"
            };
            volSlider.ValueChanged += (_, args) =>
            {
                SetPeerVolume(peerId, (float)(args.NewValue / 100.0));
            };
            stack.Children.Add(volSlider);
        }

        border.Child = stack;

        border.MouseEnter += (_, _) => { border.Background = (Brush)FindResource("BgHoverBrush"); border.BorderBrush = new SolidColorBrush(Color.FromArgb(60, 148, 163, 184)); };
        border.MouseLeave += (_, _) => { border.Background = Brushes.Transparent; border.BorderBrush = new SolidColorBrush(Color.FromArgb(30, 148, 163, 184)); };
        return border;
    }

    private void UpdateMemberCard(string peerId, bool micEnabled)
    {
        foreach (var child in MembersPanel.Children)
        {
            if (child is Border b && b.Tag is string id && id == peerId && b.Child is StackPanel s)
            {
                foreach (var el in s.Children)
                {
                    if (el is Grid g) foreach (var gc in g.Children) if (gc is Ellipse e && e.Name == "MemberAvatar") e.Fill = micEnabled ? (Brush)FindResource("AvatarOtherBrush") : (Brush)FindResource("AvatarMutedBrush");
                    if (el is Ellipse d && d.Name == "StatusDot") d.Fill = micEnabled ? (Brush)FindResource("SuccessBrush") : (Brush)FindResource("DangerBrush");
                }
                break;
            }
        }
    }

    private void RemoveMemberCard(string peerId)
    {
        for (int i = MembersPanel.Children.Count - 1; i >= 0; i--)
            if (MembersPanel.Children[i] is Border b && b.Tag is string id && id == peerId) { MembersPanel.Children.RemoveAt(i); break; }
    }

    private void UpdateOnlineCount() => OnlineCountRun.Text = (_peers.Count + 1).ToString();

    private void UpdateMicButton(bool enabled)
    {
        if (MicBtn.Template.FindName("PART_Background", MicBtn) is Ellipse bg)
            bg.Fill = enabled ? (Brush)FindResource("SuccessBrush") : (Brush)FindResource("BgInputBrush");
        MicBtn.ToolTip = enabled ? "关闭麦克风" : "开启麦克风";
    }
}
