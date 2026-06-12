using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace VoiceChat;

public partial class RoomsWindow : Window
{
    private readonly string _serverUrl;
    private readonly string _theme;
    private readonly AuthService _authService;

    private static readonly string SettingsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EchoLink");
    private static readonly string SettingsFile = Path.Combine(SettingsDir, "settings.json");

    public string? AccessToken { get; set; }
    public UserInfo? CurrentUser { get; set; }
    public string? SelectedRoomId { get; private set; }

    public RoomsWindow(string serverUrl, string theme)
    {
        InitializeComponent();
        _serverUrl = serverUrl;
        _theme = theme;
        _authService = new AuthService(serverUrl);

        Loaded += async (_, _) =>
        {
            UpdateUserInfo();
            await LoadRoomsAsync();
        };
    }

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(SettingsFile))
            {
                var json = JsonDocument.Parse(File.ReadAllText(SettingsFile));
                var root = json.RootElement;
                if (root.TryGetProperty("token", out var t) && t.ValueKind != JsonValueKind.Null)
                    AccessToken = t.GetString();
                if (root.TryGetProperty("user", out var u) && u.ValueKind == JsonValueKind.Object)
                {
                    CurrentUser = new UserInfo
                    {
                        UserId = u.TryGetProperty("userId", out var uid) ? uid.GetInt32() : 0,
                        Username = u.TryGetProperty("username", out var un) ? un.GetString() ?? "" : "",
                        DisplayName = u.TryGetProperty("displayName", out var dn) && dn.ValueKind != JsonValueKind.Null
                            ? dn.GetString()
                            : null,
                    };
                }
                if (root.TryGetProperty("room", out var r) && r.ValueKind != JsonValueKind.Null)
                    RoomInput.Text = r.GetString() ?? "";
            }
        }
        catch { }
    }

    private void ApplyTheme(string theme)
    {
        var colors = new Dictionary<string, (string bg, string text, string muted, string primary, string input, string hover)>
        {
            ["dark"] = ("#1e1f22", "#f2f3f5", "#949ba4", "#5865f2", "#383a40", "#404249"),
            ["light"] = ("#f2f3f5", "#1e1f22", "#6b7280", "#5865f2", "#e3e5e8", "#d4d7dc"),
            ["purple"] = ("#1a1025", "#f5f3ff", "#8b7faa", "#9b59b6", "#3d2d52", "#4a355e"),
            ["ocean"] = ("#0a1628", "#ecfeff", "#5e8aa8", "#0088cc", "#1e2d44", "#264060"),
            ["sunset"] = ("#1a0f0a", "#fef2f2", "#a87882", "#e67e22", "#3d2535", "#5d3a28"),
        };

        if (!colors.TryGetValue(theme, out var c)) return;

        Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.bg));
    }

    private void UpdateUserInfo()
    {
        if (CurrentUser != null)
        {
            UserInfoText.Text = $"已登录: {CurrentUser.DisplayName ?? CurrentUser.Username}";
            LogoutBtn.Visibility = Visibility.Visible;
        }
        else
        {
            UserInfoText.Text = "当前为匿名模式";
            LogoutBtn.Visibility = Visibility.Collapsed;
        }
    }

    private async Task LoadRoomsAsync()
    {
        StatusText.Text = "正在加载房间列表...";
        try
        {
            var response = await _authService.GetRoomsAsync(AccessToken);
            RenderRooms(response?.Rooms ?? Array.Empty<RoomListItem>());
            StatusText.Text = $"共 {response?.Rooms.Length ?? 0} 个房间在线";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"加载失败: {ex.Message}";
            RenderRooms(Array.Empty<RoomListItem>());
        }
    }

    private void RenderRooms(RoomListItem[] rooms)
    {
        RoomsPanel.Children.Clear();

        if (rooms.Length == 0)
        {
            RoomsPanel.Children.Add(new TextBlock
            {
                Text = "暂时没有在线房间\n输入上方房间号即可创建新房间",
                Foreground = new SolidColorBrush(Colors.Gray),
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(8, 12, 0, 0),
            });
            return;
        }

        foreach (var room in rooms)
        {
            var card = new Border
            {
                Background = Brushes.White,
                BorderBrush = new SolidColorBrush(Color.FromRgb(220, 220, 220)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 8),
                Cursor = Cursors.Hand,
            };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var info = new StackPanel();
            info.Children.Add(new TextBlock
            {
                Text = room.RoomId,
                FontSize = 15,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Colors.Black),
            });
            info.Children.Add(new TextBlock
            {
                Text = $"{room.PeerCount} 人在线",
                FontSize = 12,
                Foreground = new SolidColorBrush(Colors.Gray),
                Margin = new Thickness(0, 2, 0, 0),
            });

            var enter = new TextBlock
            {
                Text = "进入 →",
                FontSize = 13,
                Foreground = (Brush)FindResource("PrimaryBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };

            Grid.SetColumn(info, 0);
            Grid.SetColumn(enter, 1);
            grid.Children.Add(info);
            grid.Children.Add(enter);

            card.Child = grid;
            card.MouseLeftButtonDown += (_, _) => EnterRoom(room.RoomId);
            card.MouseEnter += (_, _) => card.Background = (Brush)FindResource("BgHoverBrush");
            card.MouseLeave += (_, _) => card.Background = Brushes.White;

            RoomsPanel.Children.Add(card);
        }
    }

    private void EnterRoom(string roomId)
    {
        SelectedRoomId = roomId;
        DialogResult = true;
        Close();
    }

    private void JoinBtn_Click(object sender, RoutedEventArgs e)
    {
        var roomId = RoomInput.Text.Trim();
        if (string.IsNullOrEmpty(roomId))
        {
            StatusText.Text = "请输入房间号";
            return;
        }
        EnterRoom(roomId);
    }

    private void RoomInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            JoinBtn_Click(sender, e);
        }
    }

    private async void RefreshBtn_Click(object sender, RoutedEventArgs e)
    {
        await LoadRoomsAsync();
    }

    private void LogoutBtn_Click(object sender, RoutedEventArgs e)
    {
        AccessToken = null;
        CurrentUser = null;
        UpdateUserInfo();
        _ = LoadRoomsAsync();
    }
}
