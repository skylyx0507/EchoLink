import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMediasoup, NOISE_PRESETS, type NoiseLevel } from "../hooks/useMediasoup";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

const PROBE_PORTS = [1985, 3000, 8080, 8000, 5000, 4000];

async function probePort(host: string): Promise<string> {
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/ws`;
  }
  for (const port of PROBE_PORTS) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://${host}:${port}/ws`);
        const timer = setTimeout(() => { ws.close(); resolve(false); }, 2000);
        ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(true); };
        ws.onerror = () => { clearTimeout(timer); resolve(false); };
      });
      if (ok) return `ws://${host}:${port}/ws`;
    } catch { /* port unreachable */ }
  }
  throw new Error(`无法连接到 ${host}`);
}

export function Room() {
  const navigate = useNavigate();
  const { roomId: urlRoomId } = useParams();

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
    micDevices,
    speakerDevices,
    selectedMic,
    selectedSpeaker,
    setSelectedMic,
    setSelectedSpeaker,
    enumerateAudioDevices,
    supportsSetSinkId,
  } = useMediasoup();
  const { currentTheme, setTheme, themes } = useTheme();

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement>(null);
  const autoJoinDone = useRef(false);

  useEffect(() => {
    if (autoJoinDone.current) return;
    autoJoinDone.current = true;

    const token = localStorage.getItem("echolink-token");
    const username = localStorage.getItem("echolink-username");
    const serverAddr = localStorage.getItem("echolink-server") || window.location.hostname;
    const roomId = urlRoomId || localStorage.getItem("echolink-room") || "lobby";

    if (!token || !username) {
      navigate("/");
      return;
    }

    const doJoin = async () => {
      setJoining(true);
      setError(null);
      try {
        let wsUrl: string;
        if (window.location.protocol === "https:") {
          wsUrl = `wss://${window.location.host}/ws`;
        } else if (serverAddr.includes(":")) {
          wsUrl = `ws://${serverAddr}/ws`;
        } else {
          wsUrl = await probePort(serverAddr);
        }
        await joinRoom(wsUrl, roomId, username, token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加入房间失败");
      } finally {
        setJoining(false);
      }
    };
    doJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (roomState.joined && roomState.roomId) {
      const expectedPath = `/room/${roomState.roomId}`;
      if (window.location.pathname !== expectedPath) {
        navigate(expectedPath, { replace: true });
      }
    }
  }, [roomState.joined, roomState.roomId, navigate]);

  const handleLeave = () => {
    leaveRoom();
    navigate("/rooms");
  };

  const handleToggleMic = () => {
    if (roomState.micEnabled) disableMic();
    else enableMic();
  };

  useEffect(() => {
    if (!showDeviceMenu) return;
    const handler = (e: MouseEvent) => {
      if (deviceMenuRef.current && !deviceMenuRef.current.contains(e.target as Node)) {
        setShowDeviceMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDeviceMenu]);

  if (!roomState.joined) {
    return (
      <div className="app">
        <div className="floating-particles">
          <div className="particle"></div><div className="particle"></div>
          <div className="particle"></div><div className="particle"></div>
          <div className="particle"></div><div className="particle"></div>
        </div>
        <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} themes={themes} />
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <div className="logo-mark">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <h1>EchoLink</h1>
              <p>{joining ? "正在加入房间..." : "准备连接"}</p>
            </div>
            {error && (
              <div className="auth-form">
                <div className="error-msg">{error}</div>
                <button className="auth-btn" onClick={() => navigate("/rooms")}>返回房间列表</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app room-active">
      <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} themes={themes} />

      <div className="channel-container">
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

        <div className="members-container">
          <div className="members-grid">
            <div className={`member-card ${isSpeaking ? "speaking" : ""}`}>
              <div className="member-avatar-wrapper">
                <div className={`member-avatar self ${isSpeaking ? "ring" : ""}`}>
                  {roomState.peerId.charAt(0).toUpperCase()}
                </div>
                {isSpeaking && (
                  <div className="speaking-indicator">
                    <div className="bar"></div><div className="bar"></div>
                    <div className="bar"></div><div className="bar"></div>
                    <div className="bar"></div>
                  </div>
                )}
              </div>
              <span className="member-name">{roomState.peerId}</span>
              <div className="member-status">
                <div className={`status-dot ${roomState.micEnabled ? "mic-on" : "mic-off"}`}></div>
              </div>
            </div>

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

            {roomState.peers.size === 0 && (
              <div className="empty-room" style={{ gridColumn: "1 / -1" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <p>等待其他玩家加入...</p>
              </div>
            )}
          </div>
        </div>

        <div className="control-bar">
          <div className="control-left">
            <div className={`user-avatar ${isSpeaking ? "speaking" : ""}`}>
              {roomState.peerId.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="user-name">{roomState.peerId}</span>
              <span className={`user-state ${roomState.micEnabled ? (isSpeaking ? "speaking" : "mic-on") : ""}`}>
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
            <div className="device-settings" ref={deviceMenuRef}>
              <button
                className="control-btn settings"
                onClick={() => {
                  if (!showDeviceMenu) enumerateAudioDevices();
                  setShowDeviceMenu(!showDeviceMenu);
                }}
                title="音频设备设置"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              {showDeviceMenu && (
                <div className="device-menu">
                  <div className="device-section">
                    <label>麦克风</label>
                    <select value={selectedMic} onChange={(e) => setSelectedMic(e.target.value)}>
                      {micDevices.length === 0 && <option value="">未检测到设备</option>}
                      {micDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="device-section">
                    <label>扬声器</label>
                    <select value={selectedSpeaker} onChange={(e) => setSelectedSpeaker(e.target.value)} disabled={!supportsSetSinkId}>
                      {speakerDevices.length === 0 && <option value="">未检测到设备</option>}
                      {speakerDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                    {!supportsSetSinkId && (
                      <p className="device-hint">当前浏览器不支持切换扬声器输出</p>
                    )}
                  </div>
                </div>
              )}
            </div>
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
