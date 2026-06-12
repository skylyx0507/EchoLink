import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Downloads } from "./Downloads";

interface RoomItem {
  roomId: string;
  peerCount: number;
}

export function RoomList() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuth();
  const { currentTheme, setTheme, themes } = useTheme();

  const [serverAddr, setServerAddr] = useState(
    () => localStorage.getItem("echolink-server") || window.location.hostname
  );
  const [roomId, setRoomId] = useState("");
  const [peerId, setPeerId] = useState(
    () => user?.displayName || user?.username || localStorage.getItem("echolink-peer") || ""
  );
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${window.location.protocol}//${window.location.host}/api/rooms`, {
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取房间列表失败");
      setRooms(data.rooms || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取房间列表失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => fetchRooms(), 0);
    const interval = setInterval(() => fetchRooms(), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchRooms, token]);

  const handleJoinRoom = (targetRoomId: string) => {
    if (!targetRoomId.trim()) {
      setError("房间号不能为空");
      return;
    }
    const name = peerId.trim() || user?.displayName || user?.username || `用户${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem("echolink-server", serverAddr.trim());
    localStorage.setItem("echolink-peer", name);
    navigate(`/room/${encodeURIComponent(targetRoomId.trim())}`);
  };

  const handleAnonymousJoin = (e: React.FormEvent) => {
    e.preventDefault();
    handleJoinRoom(roomId);
  };

  return (
    <div className="app">
      <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} themes={themes} />
      <div className="login-container">
        <div className="login-card room-list-card">
          <div className="login-header">
            <div className="logo-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h1>EchoLink</h1>
            <p>游戏语音，低延迟沟通</p>
          </div>

          <div className="room-list-header">
            <div className="user-info-row">
              {user ? (
                <>
                  <span>
                    欢迎，<strong>{user.displayName || user.username}</strong>
                  </span>
                  <button className="text-btn" onClick={logout}>
                    退出登录
                  </button>
                </>
              ) : (
                <>
                  <span>当前为匿名模式</span>
                  <button className="text-btn" onClick={() => navigate("/login")}>
                    登录
                  </button>
                  <button className="text-btn" onClick={() => navigate("/register")}>
                    注册
                  </button>
                </>
              )}
            </div>
          </div>

          <form className="login-form" onSubmit={handleAnonymousJoin}>
            <div className="input-group">
              <label>服务器地址</label>
              <input
                type="text"
                value={serverAddr}
                onChange={(e) => setServerAddr(e.target.value)}
                placeholder="IP 或 IP:端口"
              />
            </div>

            <div className="input-group">
              <label>你的昵称</label>
              <input
                type="text"
                value={peerId}
                onChange={(e) => setPeerId(e.target.value)}
                placeholder={user?.displayName || user?.username || "输入昵称加入房间"}
              />
            </div>

            <div className="input-group join-room-row">
              <label>房间号</label>
              <div className="join-room-input">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="输入房间号加入或创建"
                  onKeyDown={(e) => e.key === "Enter" && handleAnonymousJoin(e)}
                />
                <button className="login-btn" type="submit" disabled={!roomId.trim()}>
                  进入
                </button>
              </div>
            </div>
          </form>

          <div className="room-list-section">
            <div className="room-list-title">
              <h3>当前在线房间</h3>
              <button className="text-btn" onClick={fetchRooms} disabled={loading}>
                {loading ? "刷新中..." : "刷新"}
              </button>
            </div>

            {error && <div className="error-msg">{error}</div>}

            {rooms.length === 0 ? (
              <div className="empty-room-list">
                <p>暂时没有在线房间</p>
                <p>输入上方房间号即可创建并进入新房间</p>
              </div>
            ) : (
              <ul className="room-list">
                {rooms.map((room) => (
                  <li
                    key={room.roomId}
                    className="room-list-item"
                    onClick={() => handleJoinRoom(room.roomId)}
                  >
                    <div className="room-info">
                      <span className="room-name">{room.roomId}</span>
                      <span className="room-count">{room.peerCount} 人在线</span>
                    </div>
                    <svg
                      className="room-enter-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14" />
                      <path d="M12 5l7 7-7 7" />
                    </svg>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Downloads />
        </div>
      </div>
    </div>
  );
}
