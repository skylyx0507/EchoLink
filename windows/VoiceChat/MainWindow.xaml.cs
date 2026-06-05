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
using WebSocketSharp;

namespace VoiceChat;

public partial class MainWindow : Window
{
    // ==================== 网络 ====================
    private WebSocket? _ws;
    private string _serverUrl = "ws://localhost:3000";
    private string _roomId = "";
    private string _peerId = "";

    // ==================== mediasoup ====================
    private string? _sendTransportId;

    // ==================== RTP ====================
    private UdpClient? _sendUdp;
    private UdpClient? _recvUdp;
    private IPEndPoint? _serverSendEndPoint;
    private CancellationTokenSource? _recvCts;

    // ==================== Opus ====================
    private OpusEncoder? _opusEncoder;
    private OpusDecoder? _opusDecoder;

    // ==================== 音频 ====================
    private WaveInEvent? _micCapture;
    private WaveOutEvent? _audioOutput;
    private BufferedWaveProvider? _playbackBuffer;
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
    private readonly uint _sendSsrc = (uint)new Random().Next(100000, 999999);

    // ==================== 成员 ====================
    private record PeerInfo(string PeerId, bool MicEnabled);
    private readonly Dictionary<string, PeerInfo> _peers = new();

    // ==================== 消息等待 ====================
    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pendingMessages = new();

    // ==================== 状态 ====================
    private bool _micEnabled;
    private bool _isSpeaking;

    // 音频参数
    private const int SampleRate = 48000;
    private const int OpusChannels = 2; // mediasoup 要求 Opus 2 通道
    private const int FrameSize = 960; // 20ms @ 48kHz

    // 主题
    private string _currentTheme = "dark";

    private static readonly Dictionary<string, (string bg, string bgSecondary, string bgCard, string bgInput, string bgHover, string primary, string success, string danger)> ThemeColors = new()
    {
        ["dark"] = ("#1e1f22", "#2b2d31", "#313338", "#383a40", "#404249", "#5865f2", "#23a559", "#f23f43"),
        ["light"] = ("#f2f3f5", "#e3e5e8", "#ffffff", "#ebedef", "#d4d7dc", "#5865f2", "#23a559", "#f23f43"),
        ["purple"] = ("#1a1025", "#241830", "#2d1f3d", "#362850", "#3f305e", "#9b59b6", "#2ecc71", "#e74c3c"),
        ["ocean"] = ("#0a1628", "#0f2035", "#142a42", "#1a3350", "#1f3d5e", "#0088cc", "#00b894", "#e17055"),
        ["sunset"] = ("#1a0f0a", "#2d1a0f", "#3d2518", "#4d2f1f", "#5d3a28", "#e67e22", "#27ae60", "#c0392b"),
    };

    public MainWindow()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            PeerInput.Text = $"用户{new Random().Next(1000, 9999)}";
            PeerInput.Focus();
        };
    }

    // ==================== UI 事件 ====================

    private async void JoinBtn_Click(object sender, RoutedEventArgs e)
    {
        var server = ServerInput.Text.Trim();
        var room = RoomInput.Text.Trim();
        var peer = PeerInput.Text.Trim();

        if (string.IsNullOrEmpty(room) || string.IsNullOrEmpty(peer))
        {
            ShowError("房间号和昵称不能为空");
            return;
        }

        _serverUrl = server;
        _roomId = room;
        _peerId = peer;

        JoinBtn.IsEnabled = false;
        JoinBtn.Content = "加入中...";
        HideError();

        try
        {
            await JoinRoomAsync();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            JoinBtn.IsEnabled = true;
            JoinBtn.Content = "进入语音房间";
        }
    }

    private void LeaveBtn_Click(object sender, RoutedEventArgs e) => LeaveRoom();

    private void MicBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_micEnabled)
            DisableMic();
        else
            EnableMic();
    }

    private void NoiseLevel_Click(object sender, RoutedEventArgs e) { }

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

    // 主题切换
    private void ThemeBtn_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string theme)
        {
            ApplyTheme(theme);
            _currentTheme = theme;
        }
    }

    private void ApplyTheme(string theme)
    {
        if (!ThemeColors.TryGetValue(theme, out var c)) return;

        TryFindAndSet("BgBrush", c.bg);
        TryFindAndSet("BgSecondaryBrush", c.bgSecondary);
        TryFindAndSet("BgCardBrush", c.bgCard);
        TryFindAndSet("BgInputBrush", c.bgInput);
        TryFindAndSet("BgHoverBrush", c.bgHover);
        TryFindAndSet("PrimaryBrush", c.primary);
        TryFindAndSet("SuccessBrush", c.success);
        TryFindAndSet("DangerBrush", c.danger);
    }

    private void TryFindAndSet(string key, string color)
    {
        if (TryFindResource(key) is SolidColorBrush brush)
        {
            brush.Color = (Color)ColorConverter.ConvertFromString(color);
        }
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

        // 2. 初始化 UDP
        _sendUdp = new UdpClient(0);
        _recvUdp = new UdpClient(0);

        // 3. 连接 WebSocket
        _ws = new WebSocket(_serverUrl);
        _ws.OnMessage += (_, evt) => Dispatcher.BeginInvoke(() => HandleMessage(evt.Data));
        _ws.OnError += (_, evt) => Dispatcher.BeginInvoke(() => ShowError("连接失败: " + evt.Message));
        _ws.OnClose += (_, _) => Dispatcher.BeginInvoke(() => { if (RoomPanel.Visibility == Visibility.Visible) LeaveRoom(); });
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

        // 6. 创建接收 PlainTransport
        SendMessage(new { type = "createPlainTransport", direction = "recv" });
        var recvCreated = await WaitForMessage("plainTransportCreated");
        var recvTransportId = recvCreated.GetProperty("id").GetString()!;
        var recvIp = recvCreated.GetProperty("ip").GetString()!;
        var recvPort = recvCreated.GetProperty("port").GetInt32();

        // 7. 发送空 RTP 到接收 transport 触发 comedia 检测
        var recvEndPoint = new IPEndPoint(IPAddress.Parse(recvIp), recvPort);
        byte[] dummyRtp = new byte[12];
        dummyRtp[0] = 0x80;
        dummyRtp[1] = 0x6F;
        _sendUdp.Send(dummyRtp, dummyRtp.Length, recvEndPoint);

        // 8. 启动接收
        StartRtpReceiver();

        // 9. 切换 UI
        LoadAudioDevices();
        RoomNameText.Text = _roomId;
        ControlUserName.Text = _peerId;
        OnlineCountRun.Text = "1";
        MembersPanel.Children.Clear();
        MembersPanel.Children.Add(CreateMemberCard(_peerId, false, true));

        LoginPanel.Visibility = Visibility.Collapsed;
        RoomPanel.Visibility = Visibility.Visible;

        // 10. 消费已有 producers
        if (joined.TryGetProperty("existingProducers", out var producers))
        {
            foreach (var p in producers.EnumerateArray())
            {
                await ConsumeRemoteAsync(
                    p.GetProperty("producerId").GetString()!,
                    p.GetProperty("peerId").GetString()!);
            }
        }

        JoinBtn.IsEnabled = true;
        JoinBtn.Content = "进入语音房间";
    }

    private void LeaveRoom()
    {
        DisableMic();
        _recvCts?.Cancel();
        _sendUdp?.Dispose(); _sendUdp = null;
        _recvUdp?.Dispose(); _recvUdp = null;
        _audioOutput?.Stop(); _audioOutput?.Dispose(); _audioOutput = null;
        _playbackBuffer = null;
        _opusEncoder?.Dispose(); _opusEncoder = null;
        _opusDecoder?.Dispose(); _opusDecoder = null;

        SendMessage(new { type = "leaveRoom" });
        _ws?.Close(); _ws = null;
        _sendTransportId = null; _serverSendEndPoint = null;
        _peers.Clear(); MembersPanel.Children.Clear(); _pendingMessages.Clear();

        RoomPanel.Visibility = Visibility.Collapsed;
        LoginPanel.Visibility = Visibility.Visible;
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
                Dispatcher.BeginInvoke(() => ShowError(msg.GetProperty("message").GetString() ?? "未知错误"));
                break;
        }
    }

    // ==================== 消费远程音频 ====================

    private async Task ConsumeRemoteAsync(string producerId, string peerId)
    {
        // 创建接收 PlainTransport
        SendMessage(new { type = "createPlainTransport", direction = "recv" });
        var recvMsg = await WaitForMessage("plainTransportCreated");
        var consumerRecvIp = recvMsg.GetProperty("ip").GetString()!;
        var consumerRecvPort = recvMsg.GetProperty("port").GetInt32();

        // 发送空 RTP 触发 comedia
        var ep = new IPEndPoint(IPAddress.Parse(consumerRecvIp), consumerRecvPort);
        byte[] dummy = new byte[12]; dummy[0] = 0x80; dummy[1] = 0x6F;
        _sendUdp?.Send(dummy, dummy.Length, ep);

        // 请求消费
        SendMessage(new { type = "consume", producerId, rtpCapabilities = GetRtpCapabilities() });
        var msg = await WaitForMessage("consumed");
        var consumerId = msg.GetProperty("consumerId").GetString()!;
        SendMessage(new { type = "resumeConsuming", consumerId });

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
        _playbackBuffer = new BufferedWaveProvider(new WaveFormat(SampleRate, 16, 1))
        {
            BufferDuration = TimeSpan.FromSeconds(2),
            DiscardOnBufferOverflow = true
        };
        _audioOutput = new WaveOutEvent
        {
            DeviceNumber = _selectedSpeakerDevice >= 0 ? _selectedSpeakerDevice : 0
        };
        _audioOutput.Init(_playbackBuffer);
        _audioOutput.Play();

        _recvCts = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            while (!_recvCts.IsCancellationRequested)
            {
                try
                {
                    var result = await _recvUdp!.ReceiveAsync();
                    ProcessIncomingRtp(result.Buffer);
                }
                catch (ObjectDisposedException) { break; }
                catch { }
            }
        });
    }

    private void ProcessIncomingRtp(byte[] packet)
    {
        if (packet.Length < 12 || _opusDecoder == null) return;
        try
        {
            int cc = packet[0] & 0x0F;
            bool ext = (packet[0] & 0x10) != 0;
            int offset = 12 + cc * 4;
            if (ext && offset + 4 <= packet.Length)
                offset += (packet[offset + 2] << 8 | packet[offset + 3]) * 4 + 4;

            int len = packet.Length - offset;
            if (len <= 0) return;

            byte[] opus = new byte[len];
            Array.Copy(packet, offset, opus, 0, len);

            short[] decoded = new short[FrameSize * OpusChannels];
            int n = _opusDecoder.Decode(opus, 0, len, decoded, 0, FrameSize, false);
            if (n > 0)
            {
                // 双声道 → 单声道（取左声道）
                byte[] pcm = new byte[n * 2];
                for (int i = 0; i < n; i++)
                {
                    short sample = decoded[i * 2]; // L channel
                    pcm[i * 2] = (byte)(sample & 0xFF);
                    pcm[i * 2 + 1] = (byte)((sample >> 8) & 0xFF);
                }
                _playbackBuffer?.AddSamples(pcm, 0, pcm.Length);
            }
        }
        catch { }
    }

    private void SendRtpAudio(byte[] pcmData)
    {
        if (_sendUdp == null || _serverSendEndPoint == null || _opusEncoder == null) return;
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

                _sendUdp.Send(rtp, rtp.Length, _serverSendEndPoint);
                _sendSeq++;
                _sendTimestamp += (uint)FrameSize;
            }
        }
        catch { }
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

            // 发送 produce 请求
            SendMessage(new { type = "produce", kind = "audio", rtpParameters = BuildRtpParameters() });
            _ = WaitForMessage("produced").ContinueWith(t =>
            {
                Dispatcher.BeginInvoke(() =>
                {
                    if (!t.IsCompletedSuccessfully)
                    {
                        ShowError("produce 失败: " + t.Exception?.InnerException?.Message);
                        DisableMic();
                    }
                });
            });
        }
        catch (Exception ex)
        {
            ShowError($"麦克风开启失败: {ex.Message}");
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
        _micEnabled = false;
        ControlUserState.Text = "麦克风已关";
        UpdateMicButton(false);
        SetSpeaking(false);
    }

    private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (!_micEnabled) return;

        float max = 0;
        for (int i = 0; i < e.BytesRecorded; i += 2)
        {
            float lvl = Math.Abs(BitConverter.ToInt16(e.Buffer, i) / 32768f);
            if (lvl > max) max = lvl;
        }
        Dispatcher.BeginInvoke(() => SetSpeaking(max > 0.05f));

        byte[] pcm = new byte[e.BytesRecorded];
        Array.Copy(e.Buffer, pcm, e.BytesRecorded);
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
        }
        else
        {
            SpeakingRing.Opacity = 0;
            ((Storyboard)FindResource("SpeakingStoryboard")).Stop();
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
        var border = new Border { Tag = peerId, Width = 120, CornerRadius = new CornerRadius(12), Padding = new Thickness(8, 16, 8, 8), Cursor = System.Windows.Input.Cursors.Hand, Background = Brushes.Transparent };
        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        var avatarGrid = new Grid { Width = 52, Height = 52, Margin = new Thickness(0, 0, 0, 8) };

        avatarGrid.Children.Add(new Ellipse { Name = "MemberAvatar", Width = 48, Height = 48, Fill = isSelf ? (Brush)FindResource("AvatarSelfBrush") : micEnabled ? (Brush)FindResource("AvatarOtherBrush") : (Brush)FindResource("AvatarMutedBrush") });
        avatarGrid.Children.Add(new Ellipse { Name = "SpeakingRing", Width = 52, Height = 52, Stroke = (Brush)FindResource("SuccessBrush"), StrokeThickness = 2.5, Opacity = 0 });
        avatarGrid.Children.Add(new TextBlock { Text = initial, FontSize = 20, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });

        stack.Children.Add(avatarGrid);
        stack.Children.Add(new TextBlock { Text = peerId, FontSize = 13, FontWeight = FontWeights.Medium, Foreground = (Brush)FindResource("TextBrush"), HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 100 });
        stack.Children.Add(new Ellipse { Name = "StatusDot", Width = 12, Height = 12, Fill = micEnabled ? (Brush)FindResource("SuccessBrush") : (Brush)FindResource("DangerBrush"), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) });
        border.Child = stack;

        border.MouseEnter += (_, _) => border.Background = (Brush)FindResource("BgHoverBrush");
        border.MouseLeave += (_, _) => border.Background = Brushes.Transparent;
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

    private void ShowError(string msg) { ErrorText.Text = msg; ErrorBorder.Visibility = Visibility.Visible; }
    private void HideError() => ErrorBorder.Visibility = Visibility.Collapsed;
}
