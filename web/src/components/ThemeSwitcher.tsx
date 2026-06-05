import { useState } from "react";

interface ThemeSwitcherProps {
  currentTheme: string;
  setTheme: (theme: string) => void;
  themes: Record<string, { name: string; label: string; colors: { primary: string } }>;
}

export function ThemeSwitcher({ currentTheme, setTheme, themes }: ThemeSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="theme-switcher">
      <button
        className="theme-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="切换主题"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </button>

      {isOpen && (
        <div className="theme-dropdown">
          {Object.values(themes).map((t) => (
            <button
              key={t.name}
              className={`theme-option ${currentTheme === t.name ? "active" : ""}`}
              onClick={() => {
                setTheme(t.name);
                setIsOpen(false);
              }}
            >
              <span
                className="theme-preview"
                style={{ background: t.colors.primary }}
              />
              <span className="theme-label">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
