using System;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace VoiceChat;

public partial class LoginWindow : Window
{
    private static readonly string SettingsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EchoLink");
    private static readonly string SettingsFile = Path.Combine(SettingsDir, "settings.json");
    private static readonly int[] ProbePorts = [1985];

    private string _currentTheme = "light";
    private string _password = "";
    private string? _accessToken;
    private UserInfo? _currentUser;

    private static readonly Dictionary<string, (string bg, string bgSecondary, string text, string textMuted, string primary, string primaryHover, string success, string danger, string bgInput, string bgCard, string border)> ThemeColors = new()
    {
        ["dark"] = ("#1e1f22", "#2b2d31", "#f2f3f5", "#949ba4", "#5865f2", "#4752c4", "#23a559", "#f23f43", "#383a40", "#313338", "#3f4147"),
        ["light"] = ("#f2f3f5", "#e3e5e8", "#1e1f22", "#6b7280", "#5865f2", "#4752c4", "#23a559", "#f23f43", "#e3e5e8", "#ffffff", "#d4d7dc"),
        ["purple"] = ("#1a1025", "#2d1f3d", "#f5f3ff", "#8b7faa", "#9b59b6", "#8e44ad", "#2ecc71", "#e74c3c", "#3d2d52", "#2d1f3d", "#3f305e"),
        ["ocean"] = ("#0a1628", "#142a42", "#ecfeff", "#5e8aa8", "#0088cc", "#0077b3", "#00b894", "#e17055", "#1e2d44", "#142a42", "#1f3d5e"),
        ["sunset"] = ("#1a0f0a", "#2b1a24", "#fef2f2", "#a87882", "#e67e22", "#d35400", "#27ae60", "#c0392b", "#3d2535", "#2b1a24", "#5d3a28"),
    };

    public LoginWindow()
    {
        InitializeComponent();
        LoadSettings();
        ApplyTheme(_currentTheme);
        UpdateThemeIndicator();
        Loaded += (_, _) =>
        {
            if (string.IsNullOrEmpty(PeerInput.Text))
                PeerInput.Text = $"用户{new Random().Next(1000, 9999)}";
            PeerInput.Focus();
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
                if (root.TryGetProperty("server", out var s)) ServerInput.Text = s.GetString() ?? "localhost";
                if (root.TryGetProperty("peer", out var p)) PeerInput.Text = p.GetString() ?? "";
                if (root.TryGetProperty("theme", out var t)) _currentTheme = t.GetString() ?? "light";
                if (root.TryGetProperty("username", out var u)) UsernameInput.Text = u.GetString() ?? "";
                if (root.TryGetProperty("token", out var tok) && tok.ValueKind != JsonValueKind.Null)
                    _accessToken = tok.GetString();
                if (root.TryGetProperty("user", out var usr) && usr.ValueKind == JsonValueKind.Object)
                {
                    _currentUser = new UserInfo
                    {
                        UserId = usr.TryGetProperty("userId", out var uid) ? uid.GetInt32() : 0,
                        Username = usr.TryGetProperty("username", out var un) ? un.GetString() ?? "" : "",
                        DisplayName = usr.TryGetProperty("displayName", out var dn) && dn.ValueKind != JsonValueKind.Null
                            ? dn.GetString()
                            : null,
                    };
                }
            }
        }
        catch { }

        if (string.IsNullOrEmpty(ServerInput.Text))
            ServerInput.Text = "localhost";
    }

    private void SaveSettings()
    {
        try
        {
            Directory.CreateDirectory(SettingsDir);
            var settings = new
            {
                server = ServerInput.Text.Trim(),
                peer = PeerInput.Text.Trim(),
                theme = _currentTheme,
                username = UsernameInput.Text.Trim(),
                token = _accessToken,
                user = _currentUser,
            };
            File.WriteAllText(SettingsFile, JsonSerializer.Serialize(settings));
        }
        catch { }
    }

    private void ApplyTheme(string theme)
    {
        if (!ThemeColors.TryGetValue(theme, out var c)) return;

        var bgBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.bg));
        Background = bgBrush;
        Resources["BgBrush"] = bgBrush;
        Resources["BgSecondaryBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.bgSecondary));
        Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.text));

        // 更新资源
        Resources["TextBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.text));
        Resources["TextMutedBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.textMuted));
        Resources["PrimaryBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.primary));
        Resources["PrimaryHoverBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.primaryHover));
        Resources["SuccessBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.success));
        Resources["DangerBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.danger));
        Resources["BgInputBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.bgInput));
        Resources["BgCardBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.bgCard));
        Resources["BorderBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.border));
        Resources["TextSecondaryBrush"] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(c.textMuted));
    }

    private void ThemeBtn_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string theme)
        {
            _currentTheme = theme;
            ApplyTheme(theme);
            UpdateThemeIndicator();
        }
    }

    private void UpdateThemeIndicator()
    {
        var buttons = new[] { ThemeDark, ThemeLight, ThemePurple, ThemeOcean, ThemeSunset };
        foreach (var btn in buttons)
        {
            if (btn.Tag?.ToString() == _currentTheme)
            {
                btn.BorderBrush = new SolidColorBrush(Colors.White);
                btn.BorderThickness = new Thickness(3);
            }
            else
            {
                btn.BorderBrush = (Brush)FindResource("BorderBrush");
                btn.BorderThickness = new Thickness(2);
            }
        }
    }

    private void PeerInput_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
            JoinBtn_Click(sender, e);
    }

    private async void LoginBtn_Click(object sender, RoutedEventArgs e)
    {
        var username = UsernameInput.Text.Trim();
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(_password))
        {
            AuthStatusText.Text = "请输入用户名和密码";
            return;
        }

        LoginBtn.IsEnabled = false;
        RegisterBtn.IsEnabled = false;
        AuthStatusText.Text = "登录中...";

        try
        {
            var serverUrl = await ResolveServerUrlAsync();
            var authService = new AuthService(serverUrl);
            var result = await authService.LoginAsync(username, _password);
            if (result != null)
            {
                _accessToken = result.Token;
                _currentUser = result.User;
                SaveSettings();
                AuthStatusText.Text = $"登录成功: {result.User.DisplayName ?? result.User.Username}";
                if (string.IsNullOrEmpty(PeerInput.Text))
                    PeerInput.Text = result.User.DisplayName ?? result.User.Username;
            }
            else
            {
                AuthStatusText.Text = "登录失败";
            }
        }
        catch (Exception ex)
        {
            AuthStatusText.Text = $"登录失败: {ex.Message}";
        }
        finally
        {
            LoginBtn.IsEnabled = true;
            RegisterBtn.IsEnabled = true;
        }
    }

    private async void RegisterBtn_Click(object sender, RoutedEventArgs e)
    {
        var username = UsernameInput.Text.Trim();
        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(_password))
        {
            AuthStatusText.Text = "请输入用户名和密码";
            return;
        }
        if (_password.Length < 6)
        {
            AuthStatusText.Text = "密码至少需要 6 个字符";
            return;
        }

        LoginBtn.IsEnabled = false;
        RegisterBtn.IsEnabled = false;
        AuthStatusText.Text = "注册中...";

        try
        {
            var serverUrl = await ResolveServerUrlAsync();
            var authService = new AuthService(serverUrl);
            var result = await authService.RegisterAsync(username, _password, PeerInput.Text.Trim());
            if (result != null)
            {
                _accessToken = result.Token;
                _currentUser = result.User;
                SaveSettings();
                AuthStatusText.Text = $"注册成功: {result.User.DisplayName ?? result.User.Username}";
            }
            else
            {
                AuthStatusText.Text = "注册失败";
            }
        }
        catch (Exception ex)
        {
            AuthStatusText.Text = $"注册失败: {ex.Message}";
        }
        finally
        {
            LoginBtn.IsEnabled = true;
            RegisterBtn.IsEnabled = true;
        }
    }

    private void PasswordInput_PasswordChanged(object sender, RoutedEventArgs e)
    {
        _password = PasswordInput.Password;
    }

    private async void JoinBtn_Click(object sender, RoutedEventArgs e)
    {
        var addr = ServerInput.Text.Trim();
        var peer = PeerInput.Text.Trim();

        if (string.IsNullOrEmpty(addr) || string.IsNullOrEmpty(peer))
        {
            ShowError("服务器地址和昵称不能为空");
            return;
        }

        string serverUrl;
        try
        {
            serverUrl = await ResolveServerUrlAsync();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            return;
        }

        SaveSettings();

        JoinBtn.IsEnabled = false;
        JoinBtn.Content = "连接中...";
        LoadingBar.Visibility = Visibility.Visible;

        try
        {
            var roomsWindow = new RoomsWindow(serverUrl, _currentTheme)
            {
                AccessToken = _accessToken,
                CurrentUser = _currentUser,
            };
            if (roomsWindow.ShowDialog() == true && !string.IsNullOrEmpty(roomsWindow.SelectedRoomId))
            {
                var mainWindow = new MainWindow(serverUrl, roomsWindow.SelectedRoomId, peer, _currentTheme, _accessToken);
                mainWindow.Show();
                Close();
            }
            else
            {
                JoinBtn.IsEnabled = true;
                JoinBtn.Content = "进入房间列表";
                LoadingBar.Visibility = Visibility.Collapsed;
            }
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            JoinBtn.IsEnabled = true;
            JoinBtn.Content = "进入房间列表";
            LoadingBar.Visibility = Visibility.Collapsed;
        }
    }

    private async Task<string> ResolveServerUrlAsync()
    {
        var addr = ServerInput.Text.Trim();
        if (addr.StartsWith("ws://") || addr.StartsWith("wss://"))
            return addr;
        if (addr.Contains(':'))
            return $"ws://{addr}";

        var port = await ProbePortAsync(addr);
        return $"ws://{addr}:{port}";
    }

    private static async Task<int> ProbePortAsync(string host)
    {
        var tasks = ProbePorts.Select(async port =>
        {
            try
            {
                using var tcp = new TcpClient();
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await tcp.ConnectAsync(host, port, cts.Token);
                return port;
            }
            catch { return -1; }
        });

        var results = await Task.WhenAll(tasks);
        var port2 = results.FirstOrDefault(p => p > 0);
        if (port2 <= 0) throw new Exception($"无法连接到 {host}:{string.Join(",", ProbePorts)}，请检查服务器是否运行");
        return port2;
    }

    private void MinimizeBtn_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void CloseBtn_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void Window_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ChangedButton == System.Windows.Input.MouseButton.Left)
            DragMove();
    }

    private void ShowError(string msg)
    {
        new ErrorDialog(msg, this).ShowDialog();
    }
}
