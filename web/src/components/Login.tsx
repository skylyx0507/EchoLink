import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

const PROBE_PORTS = [1985, 3000, 8080, 8000, 5000, 4000];

async function probeServer(host: string): Promise<string> {
  if (window.location.protocol === "https:") {
    return window.location.origin;
  }
  for (const port of PROBE_PORTS) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return `http://${host}:${port}`;
    } catch { /* port unreachable */ }
  }
  throw new Error(`无法连接到 ${host}，请检查服务器地址`);
}

export function Login() {
  const navigate = useNavigate();
  const { currentTheme, setTheme, themes } = useTheme();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [serverAddr, setServerAddr] = useState(() => localStorage.getItem("echolink-server") || "localhost");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!serverAddr.trim() || !username.trim() || !password) {
      setError("服务器地址、用户名和密码不能为空");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("两次密码不一致");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const baseUrl = await probeServer(serverAddr.trim());
      localStorage.setItem("echolink-server", serverAddr.trim());
      localStorage.setItem("echolink-server-url", baseUrl);

      const endpoint = mode === "login" ? "/login" : "/register";
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || (mode === "login" ? "登录失败" : "注册失败"));
        return;
      }

      if (mode === "register") {
        const loginRes = await fetch(`${baseUrl}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) {
          setError("注册成功但登录失败");
          return;
        }
        localStorage.setItem("echolink-token", loginData.token || "");
        localStorage.setItem("echolink-username", loginData.username || username.trim());
        localStorage.setItem("echolink-userid", String(loginData.userId || ""));
      } else {
        localStorage.setItem("echolink-token", data.token || "");
        localStorage.setItem("echolink-username", data.username || username.trim());
        localStorage.setItem("echolink-userid", String(data.userId || ""));
      }

      navigate("/rooms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败");
    } finally {
      setLoading(false);
    }
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
            <p>游戏语音，低延迟沟通</p>
          </div>

          <div className="auth-tabs">
            <button className={`auth-tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setError(null); }}>
              登录
            </button>
            <button className={`auth-tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setError(null); }}>
              注册
            </button>
          </div>

          <div className="auth-form">
            <div className="input-group">
              <label>服务器地址</label>
              <input
                type="text"
                placeholder="IP 或域名（自动探测端口）"
                value={serverAddr}
                onChange={(e) => setServerAddr(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-group">
              <label>用户名</label>
              <input
                type="text"
                placeholder="2-20 个字符"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-group">
              <label>密码</label>
              <input
                type="password"
                placeholder={mode === "register" ? "至少 4 位" : "输入密码"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            {mode === "register" && (
              <div className="input-group">
                <label>确认密码</label>
                <input
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}

            <button className="auth-btn" onClick={handleSubmit} disabled={loading}>
              {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
