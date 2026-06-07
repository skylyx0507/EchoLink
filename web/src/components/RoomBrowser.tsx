import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

interface RoomInfo {
  id: string;
  peers: number;
}

export function RoomBrowser() {
  const navigate = useNavigate();
  const { currentTheme, setTheme, themes } = useTheme();

  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [newRoomId, setNewRoomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const username = localStorage.getItem("echolink-username") || "";
  const serverUrl = localStorage.getItem("echolink-server-url") || "";

  const fetchRooms = useCallback(async () => {
    if (!serverUrl) return;
    try {
      const res = await fetch(`${serverUrl}/api/rooms`);
      if (!res.ok) throw new Error("获取房间列表失败");
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取房间列表失败");
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    const token = localStorage.getItem("echolink-token");
    if (!token) {
      navigate("/");
      return;
    }
    fetchRooms(); // eslint-disable-line react-hooks/set-state-in-effect
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, [fetchRooms, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("echolink-token");
    localStorage.removeItem("echolink-username");
    localStorage.removeItem("echolink-userid");
    navigate("/");
  };

  const handleJoinRoom = (roomId: string) => {
    if (!roomId.trim()) return;
    navigate(`/room/${encodeURIComponent(roomId.trim())}`);
  };

  const handleCreateRoom = () => {
    if (!newRoomId.trim()) {
      setError("请输入房间名");
      return;
    }
    handleJoinRoom(newRoomId.trim());
  };

  return (
    <div className="app">
      <div className="floating-particles">
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
      </div>
      <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} themes={themes} />

      <div className="browser-container">
        <div className="browser-header">
          <div className="browser-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <h1>EchoLink</h1>
          </div>
          <div className="browser-user">
            <div className="user-avatar-small">{username.charAt(0).toUpperCase()}</div>
            <span className="user-name-display">{username}</span>
            <button className="logout-btn" onClick={handleLogout} title="退出登录">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="browser-content">
          <div className="create-room-section">
            <h2>创建或加入房间</h2>
            <div className="create-room-form">
              <input
                type="text"
                placeholder="输入房间名..."
                value={newRoomId}
                onChange={(e) => setNewRoomId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
              />
              <button className="create-room-btn" onClick={handleCreateRoom}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                加入
              </button>
            </div>
          </div>

          <div className="rooms-section">
            <h2>在线房间 {rooms.length > 0 && <span className="room-count">{rooms.length}</span>}</h2>

            {error && <div className="error-msg">{error}</div>}

            {loading ? (
              <div className="rooms-loading">
                <div className="loading-spinner"></div>
                <p>加载房间列表...</p>
              </div>
            ) : rooms.length === 0 ? (
              <div className="rooms-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <p>暂无在线房间</p>
                <span>输入房间名创建第一个房间</span>
              </div>
            ) : (
              <div className="rooms-grid">
                {rooms.map((room) => (
                  <div key={room.id} className="room-card" onClick={() => handleJoinRoom(room.id)}>
                    <div className="room-card-header">
                      <div className="room-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        </svg>
                      </div>
                      <span className="room-name">{room.id}</span>
                    </div>
                    <div className="room-card-footer">
                      <div className="room-peers">
                        <div className="peer-dots">
                          {Array.from({ length: Math.min(room.peers, 5) }).map((_, i) => (
                            <div key={i} className="peer-dot"></div>
                          ))}
                        </div>
                        <span>{room.peers} 人在线</span>
                      </div>
                      <button className="join-btn">加入</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
