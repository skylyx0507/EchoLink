import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

export function Login() {
  const navigate = useNavigate();
  const { login, loading, error, clearError } = useAuth();
  const { currentTheme, setTheme, themes } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const ok = await login(username, password);
    if (ok) {
      navigate("/");
    }
  };

  return (
    <div className="app">
      <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} themes={themes} />
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
            <h1>登录 EchoLink</h1>
            <p>使用账号登录以保存你的昵称和设置</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="input-group">
              <label>用户名</label>
              <input
                type="text"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="input-group">
              <label>密码</label>
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && <div className="error-msg">{error}</div>}

            <button className="login-btn" type="submit" disabled={loading || !username || !password}>
              {loading ? "登录中..." : "登录"}
            </button>

            <div className="auth-links">
              <Link to="/register">还没有账号？立即注册</Link>
              <Link to="/">暂不登录，直接加入房间</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
