import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { ThemeSwitcher } from "./ThemeSwitcher";

export function Register() {
  const navigate = useNavigate();
  const { register, loading, error, clearError } = useAuth();
  const { currentTheme, setTheme, themes } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError("两次输入的密码不一致");
      return;
    }
    if (password.length < 6) {
      setLocalError("密码至少需要 6 个字符");
      return;
    }

    const ok = await register(username, password, displayName || undefined);
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
            <h1>注册 EchoLink</h1>
            <p>创建账号，开启语音沟通</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="input-group">
              <label>用户名</label>
              <input
                type="text"
                placeholder="至少 3 个字符"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="input-group">
              <label>显示昵称</label>
              <input
                type="text"
                placeholder="加入房间时显示的名称（可选）"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label>密码</label>
              <input
                type="password"
                placeholder="至少 6 个字符"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label>确认密码</label>
              <input
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {(error || localError) && <div className="error-msg">{error || localError}</div>}

            <button
              className="login-btn"
              type="submit"
              disabled={loading || !username || !password || !confirmPassword}
            >
              {loading ? "注册中..." : "注册"}
            </button>

            <div className="auth-links">
              <Link to="/login">已有账号？立即登录</Link>
              <Link to="/">暂不登录，直接加入房间</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
