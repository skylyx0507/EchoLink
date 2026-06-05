using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using NAudio.Wave;
using SIPSorceryMedia.Abstractions;
using WebSocketSharp;

namespace VoiceChat;

public partial class MainWindow : Window
{
    // WebSocket 连接
    private WebSocket? _ws;
    private string _serverUrl = "ws://localhost:3000";
    private string _roomId = "";
    private string _peerId = "";

    // mediasoup Transport ID
    private string? _sendTransportId;
    private string? _recvTransportId;

    // 音频
    private WaveInEvent? _micCapture;
    private WaveOutEvent? _audioOutput;
    private BufferedWaveProvider? _playbackBuffer;

    // 成员管理
    private record PeerInfo(string PeerId, bool MicEnabled);
    private readonly Dictionary<string, PeerInfo> _peers = new();

    // 消息等待器
    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pendingMessages = new();

    // 状态
    private bool _micEnabled;
    private bool _isSpeaking;
    private DispatcherTimer? _levelTimer;

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
            await JoinRoom();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            JoinBtn.IsEnabled = true;
            JoinBtn.Content = "进入语音房间";
        }
    }

    private void LeaveBtn_Click(object sender, RoutedEventArgs e)
    {
        LeaveRoom();
    }

    private void MicBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_micEnabled)
            DisableMic();
        else
            EnableMic();
    }

    private void NoiseLevel_Click(object sender, RoutedEventArgs e)
    {
        // 降噪档位切换（后续实现）
    }

    // ==================== 房间管理 ====================

    private async Task JoinRoom()
    {
        // 连接 WebSocket
        _ws = new WebSocket(_serverUrl);

        _ws.OnMessage += (_, evt) =>
        {
            Dispatcher.BeginInvoke(() => HandleMessage(evt.Data));
        };

        _ws.OnError += (_, evt) =>
        {
            Dispatcher.BeginInvoke(() => ShowError("连接失败: " + evt.Message));
        };

        _ws.OnClose += (_, _) =>
        {
            Dispatcher.BeginInvoke(() =>
            {
                if (RoomPanel.Visibility == Visibility.Visible)
                    LeaveRoom();
            });
        };

        _ws.Connect();

        if (_ws.ReadyState != WebSocketState.Open)
        {
            throw new Exception("无法连接到服务器");
        }

        // 发送 joinRoom
        SendMessage(new { type = "joinRoom", roomId = _roomId, peerId = _peerId });

        // 等待 joinedRoom 响应
        var joined = await WaitForMessage("joinedRoom");

        // 初始化 UI
        RoomNameText.Text = _roomId;
        ControlUserName.Text = _peerId;
        OnlineCountRun.Text = "1";
        MembersPanel.Children.Clear();
        MembersPanel.Children.Add(CreateMemberCard(_peerId, false, true));

        LoginPanel.Visibility = Visibility.Collapsed;
        RoomPanel.Visibility = Visibility.Visible;

        // 创建 mediasoup transports
        await CreateSendTransport();
        await CreateRecvTransport();

        // 消费已有 producers
        if (joined.TryGetProperty("existingProducers", out var producers))
        {
            foreach (var p in producers.EnumerateArray())
            {
                var pid = p.GetProperty("producerId").GetString()!;
                var pPeerId = p.GetProperty("peerId").GetString()!;
                await ConsumeRemote(pid, pPeerId);
            }
        }

        JoinBtn.IsEnabled = true;
        JoinBtn.Content = "进入语音房间";
    }

    private void LeaveRoom()
    {
        DisableMic();
        _audioOutput?.Stop();
        _audioOutput?.Dispose();
        _audioOutput = null;
        _playbackBuffer = null;

        SendMessage(new { type = "leaveRoom" });
        _ws?.Close();
        _ws = null;
        _sendTransportId = null;
        _recvTransportId = null;
        _peers.Clear();
        MembersPanel.Children.Clear();
        _pendingMessages.Clear();

        RoomPanel.Visibility = Visibility.Collapsed;
        LoginPanel.Visibility = Visibility.Visible;
    }

    // ==================== WebSocket 信令 ====================

    private void SendMessage(object msg)
    {
        if (_ws?.ReadyState == WebSocketState.Open)
        {
            _ws.Send(JsonSerializer.Serialize(msg));
        }
    }

    private Task<JsonElement> WaitForMessage(string type, int timeoutMs = 10000)
    {
        var tcs = new TaskCompletionSource<JsonElement>();
        _pendingMessages[type] = tcs;

        // 超时处理
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(timeoutMs) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            if (_pendingMessages.Remove(type))
            {
                tcs.TrySetException(new TimeoutException($"等待消息 {type} 超时"));
            }
        };
        timer.Start();

        return tcs.Task;
    }

    private void HandleMessage(string data)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(data);
        }
        catch
        {
            return;
        }

        var msg = doc.RootElement;
        var type = msg.GetProperty("type").GetString();

        // 检查是否有等待的处理器
        if (type != null && _pendingMessages.TryGetValue(type, out var tcs))
        {
            _pendingMessages.Remove(type);
            tcs.TrySetResult(msg);
            return;
        }

        switch (type)
        {
            case "newProducer":
                _ = ConsumeRemote(
                    msg.GetProperty("producerId").GetString()!,
                    msg.GetProperty("peerId").GetString()!);
                break;

            case "producerClosed":
            {
                var closedPeerId = msg.GetProperty("peerId").GetString()!;
                if (_peers.TryGetValue(closedPeerId, out var peer))
                {
                    _peers[closedPeerId] = peer with { MicEnabled = false };
                    UpdateMemberCard(closedPeerId, false);
                }
                break;
            }

            case "peerJoined":
            {
                var pId = msg.GetProperty("peerId").GetString()!;
                if (!_peers.ContainsKey(pId))
                {
                    _peers[pId] = new PeerInfo(pId, false);
                    MembersPanel.Children.Add(CreateMemberCard(pId, false, false));
                    UpdateOnlineCount();
                }
                break;
            }

            case "peerLeft":
            {
                var pId = msg.GetProperty("peerId").GetString()!;
                _peers.Remove(pId);
                RemoveMemberCard(pId);
                UpdateOnlineCount();
                break;
            }

            case "consumerClosed":
            {
                // 远端 producer 关闭
                break;
            }

            case "error":
                ShowError(msg.GetProperty("message").GetString() ?? "未知错误");
                break;
        }
    }

    // ==================== mediasoup Transport ====================

    private async Task CreateSendTransport()
    {
        SendMessage(new { type = "createTransport", direction = "send" });
        var msg = await WaitForMessage("transportCreated");
        _sendTransportId = msg.GetProperty("id").GetString();

        // 将服务器的 transport 参数回传，完成 DTLS 握手
        var dtls = msg.GetProperty("dtlsParameters");
        SendMessage(new
        {
            type = "connectTransport",
            transportId = _sendTransportId,
            dtlsParameters = dtls
        });

        await WaitForMessage("transportConnected");
    }

    private async Task CreateRecvTransport()
    {
        SendMessage(new { type = "createTransport", direction = "recv" });
        var msg = await WaitForMessage("transportCreated");
        _recvTransportId = msg.GetProperty("id").GetString();

        var dtls = msg.GetProperty("dtlsParameters");
        SendMessage(new
        {
            type = "connectTransport",
            transportId = _recvTransportId,
            dtlsParameters = dtls
        });

        await WaitForMessage("transportConnected");
    }

    // ==================== 消费远程音频 ====================

    private async Task ConsumeRemote(string producerId, string peerId)
    {
        // 请求消费远端音频
        SendMessage(new
        {
            type = "consume",
            producerId,
            rtpCapabilities = GetRtpCapabilities()
        });

        var msg = await WaitForMessage("consumed");
        var consumerId = msg.GetProperty("consumerId").GetString()!;
        var kind = msg.GetProperty("kind").GetString()!;

        if (kind == "audio")
        {
            // 初始化音频输出（如果还没有）
            if (_audioOutput == null)
            {
                _playbackBuffer = new BufferedWaveProvider(new WaveFormat(48000, 16, 1))
                {
                    BufferDuration = TimeSpan.FromSeconds(2),
                    DiscardOnBufferOverflow = true
                };
                _audioOutput = new WaveOutEvent();
                _audioOutput.Init(_playbackBuffer);
                _audioOutput.Play();
            }

            // TODO: 接收 RTP 音频数据并写入 _playbackBuffer
            // 这需要实现 mediasoup RTP 数据通道
            // 当前 PoC 先验证信令流程
        }

        // 更新对端信息
        if (!_peers.ContainsKey(peerId))
        {
            _peers[peerId] = new PeerInfo(peerId, true);
            MembersPanel.Children.Add(CreateMemberCard(peerId, true, false));
        }
        else
        {
            _peers[peerId] = _peers[peerId] with { MicEnabled = true };
            UpdateMemberCard(peerId, true);
        }
        UpdateOnlineCount();

        // 恢复消费
        SendMessage(new { type = "resumeConsuming", consumerId });
    }

    // ==================== 麦克风控制 ====================

    private void EnableMic()
    {
        try
        {
            _micCapture = new WaveInEvent
            {
                WaveFormat = new WaveFormat(48000, 16, 1),
                BufferMilliseconds = 20
            };

            _micCapture.DataAvailable += OnMicDataAvailable;
            _micCapture.StartRecording();

            // 构造 rtpParameters 并发送 produce 请求
            var rtpParams = BuildRtpParameters();
            SendMessage(new
            {
                type = "produce",
                kind = "audio",
                rtpParameters = rtpParams
            });

            // 异步等待 produced 响应
            _ = WaitForMessage("produced").ContinueWith(t =>
            {
                Dispatcher.BeginInvoke(() =>
                {
                    if (t.IsCompletedSuccessfully)
                    {
                        _micEnabled = true;
                        ControlUserState.Text = "麦克风已开";
                        UpdateMicUI(true);
                        StartLevelMonitor();
                    }
                    else
                    {
                        ShowError("麦克风开启失败: " + t.Exception?.InnerException?.Message);
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

        StopLevelMonitor();
        _micEnabled = false;
        ControlUserState.Text = "麦克风已关";
        UpdateMicUI(false);
        SetSpeaking(false);
    }

    private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (!_micEnabled) return;

        // 计算音量用于说话检测
        float maxSample = 0;
        for (int i = 0; i < e.BytesRecorded; i += 2)
        {
            short sample = BitConverter.ToInt16(e.Buffer, i);
            float sample32 = sample / 32768f;
            if (Math.Abs(sample32) > maxSample)
                maxSample = Math.Abs(sample32);
        }

        Dispatcher.BeginInvoke(() => SetSpeaking(maxSample > 0.05f));

        // TODO: 将音频编码为 Opus 并通过 RTP 发送到 mediasoup
        // 这需要实现 mediasoup RTP 发送通道
    }

    // ==================== 音量监测 ====================

    private void StartLevelMonitor()
    {
        _levelTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _levelTimer.Start();
    }

    private void StopLevelMonitor()
    {
        _levelTimer?.Stop();
        _levelTimer = null;
    }

    // ==================== 说话检测 UI ====================

    private void SetSpeaking(bool speaking)
    {
        if (_isSpeaking == speaking) return;
        _isSpeaking = speaking;

        var ring = SpeakingRing;
        if (ring == null) return;

        if (speaking)
        {
            ring.Opacity = 1;
            var sb = (Storyboard)FindResource("SpeakingStoryboard");
            sb.Begin();
        }
        else
        {
            ring.Opacity = 0;
            var sb = (Storyboard)FindResource("SpeakingStoryboard");
            sb.Stop();
        }
    }

    // ==================== RTP 参数构造 ====================

    private object BuildRtpParameters()
    {
        var ssrc = (uint)new Random().Next(100000, 999999);
        return new
        {
            mid = "0",
            codecs = new[]
            {
                new
                {
                    mimeType = "audio/opus",
                    payloadType = 111,
                    clockRate = 48000,
                    channels = 2,
                    parameters = new { useinbandfec = 1 }
                }
            },
            headerExtensions = new object[]
            {
                new { id = 1, uri = "urn:ietf:params:rtp-hdrext:ssrc-audio-level" }
            },
            encodings = new[]
            {
                new { ssrc }
            },
            rtcp = new
            {
                cname = $"echolink-{Guid.NewGuid():N}",
                ssrc
            }
        };
    }

    private object GetRtpCapabilities()
    {
        return new
        {
            codecs = new[]
            {
                new
                {
                    kind = "audio",
                    mimeType = "audio/opus",
                    clockRate = 48000,
                    channels = 2,
                    parameters = new { useinbandfec = 1 },
                    rtcpFeedback = Array.Empty<object>()
                }
            },
            headerExtensions = new[]
            {
                new
                {
                    kind = "audio",
                    uri = "urn:ietf:params:rtp-hdrext:sdes:mid",
                    preferredId = 1,
                    preferredEncrypt = false,
                    direction = "sendrecv"
                }
            }
        };
    }

    // ==================== 成员卡片 UI ====================

    private Border CreateMemberCard(string peerId, bool micEnabled, bool isSelf)
    {
        var initial = peerId.Length > 0 ? peerId[0].ToString().ToUpper() : "?";

        var border = new Border
        {
            Tag = peerId,
            Width = 120,
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(8, 16, 8, 8),
            Cursor = System.Windows.Input.Cursors.Hand,
            Background = Brushes.Transparent
        };

        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };

        // 头像容器
        var avatarGrid = new Grid { Width = 52, Height = 52, Margin = new Thickness(0, 0, 0, 8) };

        var avatar = new Ellipse
        {
            Name = "MemberAvatar",
            Width = 48,
            Height = 48,
            Fill = isSelf
                ? (Brush)FindResource("AvatarSelfBrush")
                : micEnabled
                    ? (Brush)FindResource("AvatarOtherBrush")
                    : (Brush)FindResource("AvatarMutedBrush")
        };

        var ring = new Ellipse
        {
            Name = "SpeakingRing",
            Width = 52,
            Height = 52,
            Stroke = (Brush)FindResource("SuccessBrush"),
            StrokeThickness = 2.5,
            Opacity = 0
        };

        var initialText = new TextBlock
        {
            Text = initial,
            FontSize = 20,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brushes.White,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };

        avatarGrid.Children.Add(avatar);
        avatarGrid.Children.Add(ring);
        avatarGrid.Children.Add(initialText);

        var nameText = new TextBlock
        {
            Text = peerId,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = (Brush)FindResource("TextBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 100
        };

        var statusDot = new Ellipse
        {
            Name = "StatusDot",
            Width = 12,
            Height = 12,
            Fill = micEnabled
                ? (Brush)FindResource("SuccessBrush")
                : (Brush)FindResource("DangerBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 4, 0, 0)
        };

        stack.Children.Add(avatarGrid);
        stack.Children.Add(nameText);
        stack.Children.Add(statusDot);
        border.Child = stack;

        border.MouseEnter += (_, _) => border.Background = (Brush)FindResource("BgHoverBrush");
        border.MouseLeave += (_, _) => border.Background = Brushes.Transparent;

        return border;
    }

    private void UpdateMemberCard(string peerId, bool micEnabled)
    {
        foreach (var child in MembersPanel.Children)
        {
            if (child is Border border && border.Tag is string id && id == peerId)
            {
                var stack = border.Child as StackPanel;
                if (stack == null) break;

                foreach (var elem in stack.Children)
                {
                    if (elem is Grid grid)
                    {
                        foreach (var gChild in grid.Children)
                        {
                            if (gChild is Ellipse ellipse && ellipse.Name == "MemberAvatar")
                            {
                                ellipse.Fill = micEnabled
                                    ? (Brush)FindResource("AvatarOtherBrush")
                                    : (Brush)FindResource("AvatarMutedBrush");
                            }
                        }
                    }
                    else if (elem is Ellipse dot && dot.Name == "StatusDot")
                    {
                        dot.Fill = micEnabled
                            ? (Brush)FindResource("SuccessBrush")
                            : (Brush)FindResource("DangerBrush");
                    }
                }
                break;
            }
        }
    }

    private void RemoveMemberCard(string peerId)
    {
        for (int i = MembersPanel.Children.Count - 1; i >= 0; i--)
        {
            if (MembersPanel.Children[i] is Border border && border.Tag is string id && id == peerId)
            {
                MembersPanel.Children.RemoveAt(i);
                break;
            }
        }
    }

    private void UpdateOnlineCount()
    {
        OnlineCountRun.Text = (_peers.Count + 1).ToString();
    }

    private void UpdateMicUI(bool enabled)
    {
        MicBtn.ToolTip = enabled ? "关闭麦克风" : "开启麦克风";
    }

    private void ShowError(string msg)
    {
        ErrorText.Text = msg;
        ErrorBorder.Visibility = Visibility.Visible;
    }

    private void HideError()
    {
        ErrorBorder.Visibility = Visibility.Collapsed;
    }
}
