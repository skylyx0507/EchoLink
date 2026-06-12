using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace VoiceChat;

public class AuthResult
{
    public UserInfo User { get; set; } = new();
    public string Token { get; set; } = "";
}

public class UserInfo
{
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string? DisplayName { get; set; }
}

public class RoomListItem
{
    public string RoomId { get; set; } = "";
    public int PeerCount { get; set; }
}

public class RoomListResponse
{
    public RoomListItem[] Rooms { get; set; } = Array.Empty<RoomListItem>();
}

public class AuthService
{
    private readonly HttpClient _httpClient = new();
    private readonly string _baseUrl;

    public AuthService(string serverUrl)
    {
        // serverUrl is typically "ws://host:port" or "wss://host:port".
        // Convert to HTTP base URL for REST API calls.
        var httpUrl = serverUrl
            .Replace("wss://", "https://", StringComparison.OrdinalIgnoreCase)
            .Replace("ws://", "http://", StringComparison.OrdinalIgnoreCase);

        // Remove trailing "/ws" if present.
        if (httpUrl.EndsWith("/ws", StringComparison.OrdinalIgnoreCase))
        {
            httpUrl = httpUrl[..^3];
        }

        _baseUrl = httpUrl.TrimEnd('/');
    }

    public async Task<AuthResult?> LoginAsync(string username, string password)
    {
        var payload = new { username, password };
        return await PostAsync<AuthResult>("/api/auth/login", payload);
    }

    public async Task<AuthResult?> RegisterAsync(string username, string password, string? displayName = null)
    {
        var payload = new { username, password, displayName };
        return await PostAsync<AuthResult>("/api/auth/register", payload);
    }

    public async Task<RoomListResponse?> GetRoomsAsync(string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/rooms");
        if (!string.IsNullOrEmpty(token))
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        var response = await _httpClient.SendAsync(request);
        var json = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            throw new Exception($"获取房间列表失败: {json}");
        }

        return JsonSerializer.Deserialize<RoomListResponse>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
    }

    private async Task<T?> PostAsync<T>(string path, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _httpClient.PostAsync($"{_baseUrl}{path}", content);
        var responseJson = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            var error = TryGetError(responseJson);
            throw new Exception(error ?? $"请求失败: {(int)response.StatusCode}");
        }

        return JsonSerializer.Deserialize<T>(responseJson, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
    }

    private static string? TryGetError(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("error", out var error))
            {
                return error.GetString();
            }
        }
        catch
        {
            // Ignore parse errors.
        }
        return null;
    }
}
