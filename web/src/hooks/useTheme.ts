import { useState, useEffect, useCallback } from "react";
import { themes, defaultTheme, type Theme } from "../themes";

const STORAGE_KEY = "echolink-theme";

export function useTheme() {
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && themes[saved] ? saved : defaultTheme;
  });

  const theme: Theme = themes[currentTheme];

  // 应用主题到 CSS 变量
  useEffect(() => {
    const root = document.documentElement;
    const { colors } = theme;

    root.style.setProperty("--primary", colors.primary);
    root.style.setProperty("--primary-hover", colors.primaryHover);
    root.style.setProperty("--primary-light", colors.primaryLight);
    root.style.setProperty("--success", colors.success);
    root.style.setProperty("--success-light", colors.successLight);
    root.style.setProperty("--danger", colors.danger);
    root.style.setProperty("--danger-light", colors.dangerLight);
    root.style.setProperty("--bg", colors.bg);
    root.style.setProperty("--bg-card", colors.bgCard);
    root.style.setProperty("--bg-input", colors.bgInput);
    root.style.setProperty("--text", colors.text);
    root.style.setProperty("--text-secondary", colors.textSecondary);
    root.style.setProperty("--text-muted", colors.textMuted);
    root.style.setProperty("--border", colors.border);
    root.style.setProperty("--gradient", colors.gradient);
  }, [theme]);

  // 切换主题
  const setTheme = useCallback((themeName: string) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName);
      localStorage.setItem(STORAGE_KEY, themeName);
    }
  }, []);

  return {
    currentTheme,
    theme,
    setTheme,
    themes,
  };
}
