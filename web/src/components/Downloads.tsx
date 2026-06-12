import { useState } from "react";

interface ClientDownload {
  name: string;
  version: string;
  platform: string;
  url: string;
  size: string;
  description: string;
}

interface DownloadsConfig {
  clients: ClientDownload[];
  lastUpdated: string;
}

function getPlatformIcon(platform: string) {
  if (platform === "windows") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M0 0h11v11H0z M12 0h11v11H12z M0 12h11v11H0z M12 12h11v11H12z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function Downloads() {
  const [config, setConfig] = useState<DownloadsConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/downloads.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DownloadsConfig = await res.json();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !config && !error) {
      fetchConfig();
    }
  };

  return (
    <div className="downloads-wrapper">
      <button
        className="downloads-toggle"
        onClick={handleToggle}
        title="客户端下载"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>客户端下载</span>
      </button>

      {expanded && (
        <div className="downloads-panel">
          {loading && (
            <div className="downloads-loading">
              <div className="spinner" />
              <span>加载中...</span>
            </div>
          )}

          {error && (
            <div className="downloads-error">
              <p>加载配置失败：{error}</p>
              <button onClick={fetchConfig}>重试</button>
            </div>
          )}

          {config && config.clients.length === 0 && (
            <p className="downloads-empty">暂无可用客户端</p>
          )}

          {config && config.clients.length > 0 && (
            <div className="downloads-list">
              {config.clients.map((client) => (
                <a
                  key={client.platform}
                  href={client.url}
                  className="download-card"
                  download
                >
                  <div className="download-icon">{getPlatformIcon(client.platform)}</div>
                  <div className="download-info">
                    <span className="download-name">{client.name}</span>
                    <span className="download-meta">
                      v{client.version} · {client.size}
                    </span>
                    <span className="download-desc">{client.description}</span>
                  </div>
                  <div className="download-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                </a>
              ))}
              {config.lastUpdated && (
                <p className="downloads-updated">更新于 {config.lastUpdated}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
