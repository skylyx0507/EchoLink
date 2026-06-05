import { useState } from "react";
import { useMediasoup, NOISE_PRESETS, type NoiseLevel } from "../hooks/useMediasoup";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

export function Room() {
  const {
    roomState,
    isSpeaking,
    noiseLevel,
    latency,
    joinRoom,
    leaveRoom,
    enableMic,
    disableMic,
    setNoiseLevel,
  } = useMediasoup();
  const { currentTheme, setTheme, themes } = useTheme();

  const [roomId, setRoomId] = useState("test-room");
  const [peerId, setPeerId] = useState(
    () => `用户${Math.random().toString(36).slice(2, 6)}`
  );
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!roomId.trim() || !peerId.trim()) {
      setError("房间号和昵称不能为空");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      await joinRoom(roomId.trim(), peerId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = () => {
    leaveRoom();
  };

  const handleToggleMic = () => {
    if (roomState.micEnabled) {
      disableMic();
    } else {
      enableMic();
    }
  };

  // 加入房间界面 - Discord 风格的简洁登录
  if (!roomState.joined) {
    return (
      <div className="app">
        <ThemeSwitcher
          currentTheme={currentTheme}
          setTheme={setTheme}
          themes={themes}
        />
        <div className="login-container">
          <div className="login-card">
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

            <div className="login-form">
              <div className="input-group">
                <label>房间号</label>
                <input
                  type="text"
                  placeholder="输入房间号加入或创建"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={joining}
                />
              </div>

              <div className="input-group">
                <label>昵称</label>
                <input
                  type="text"
                  placeholder="你的游戏昵称"
                  value={peerId}
                  onChange={(e) => setPeerId(e.target.value)}
                  disabled={joining}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                />
              </div>

              {error && <div className="error-msg">{error}</div>}

              <button
                className="login-btn"
                onClick={handleJoin}
                disabled={joining}
              >
                {joining ? "加入中..." : "进入语音房间"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 房间界面 - Discord 风格的语音频道
  return (
    <div className="app room-active">
      <ThemeSwitcher
        currentTheme={currentTheme}
        setTheme={setTheme}
        themes={themes}
      />

      {/* 主内容区 */}
      <div className="channel-container">
        {/* 频道头部 */}
        <div className="channel-header">
          <div className="channel-info">
            <div className="voice-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" strokeWidth="2" stroke="currentColor" fill="none" />
                <line x1="8" y1="23" x2="16" y2="23" strokeWidth="2" stroke="currentColor" fill="none" />
              </svg>
            </div>
            <div>
              <h2>{roomState.roomId}</h2>
              <span className="channel-type">语音频道</span>
            </div>
          </div>
          <div className="channel-actions">
            <div className="noise-control">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
              <div className="noise-buttons">
                {(Object.keys(NOISE_PRESETS) as NoiseLevel[]).map((level) => (
                  <button
                    key={level}
                    className={`noise-btn ${noiseLevel === level ? "active" : ""}`}
                    onClick={() => setNoiseLevel(level)}
                  >
                    {NOISE_PRESETS[level].label}
                  </button>
                ))}
              </div>
            </div>
            <button className="action-btn disconnect" onClick={handleLeave} title="断开连接">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
          </div>
        </div>

        {/* 成员列表 */}
        <div className="members-container">
          <div className="members-grid">
            {/* 自己 */}
            <div className={`member-card ${isSpeaking ? "speaking" : ""}`}>
              <div className="member-avatar-wrapper">
                <div className={`member-avatar self ${isSpeaking ? "ring" : ""}`}>
                  {roomState.peerId.charAt(0).toUpperCase()}
                </div>
                {isSpeaking && (
                  <div className="speaking-indicator">
                    <div className="bar"></div>
                    <div className="bar"></div>
                    <div className="bar"></div>
                    <div className="bar"></div>
                  </div>
                )}
              </div>
              <span className="member-name">{roomState.peerId}</span>
              <div className="member-status">
                <div className={`status-dot ${roomState.micEnabled ? "mic-on" : "mic-off"}`}></div>
              </div>
            </div>

            {/* 其他成员 */}
            {Array.from(roomState.peers.values()).map((peer) => (
              <div key={peer.peerId} className="member-card">
                <div className="member-avatar-wrapper">
                  <div className={`member-avatar other ${peer.micEnabled ? "" : "muted"}`}>
                    {peer.peerId.charAt(0).toUpperCase()}
                  </div>
                </div>
                <span className="member-name">{peer.peerId}</span>
                <div className="member-status">
                  <div className={`status-dot ${peer.micEnabled ? "mic-on" : "mic-off"}`}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 底部控制栏 */}
        <div className="control-bar">
          <div className="control-left">
            <div className={`user-avatar ${isSpeaking ? "speaking" : ""}`}>
              {roomState.peerId.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="user-name">{roomState.peerId}</span>
              <span className="user-state">
                {roomState.micEnabled ? (isSpeaking ? "说话中..." : "麦克风已开") : "麦克风已关"}
              </span>
            </div>
          </div>

          <div className="control-center">
            <button
              className={`control-btn mic ${roomState.micEnabled ? "on" : "off"} ${isSpeaking ? "active" : ""}`}
              onClick={handleToggleMic}
              title={roomState.micEnabled ? "关闭麦克风" : "开启麦克风"}
            >
              {roomState.micEnabled ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          </div>

          <div className="control-right">
            {roomState.micEnabled && latency > 0 && (
              <span className={`latency ${latency < 50 ? "good" : latency < 100 ? "medium" : "bad"}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {latency}ms
              </span>
            )}
            <span className="online-count">
              <span className="count">{roomState.peers.size + 1}</span> 在线
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
