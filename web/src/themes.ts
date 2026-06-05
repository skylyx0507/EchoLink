// 主题配置
export interface Theme {
  name: string;
  label: string;
  colors: {
    primary: string;
    primaryHover: string;
    primaryLight: string;
    success: string;
    successLight: string;
    danger: string;
    dangerLight: string;
    bg: string;
    bgCard: string;
    bgInput: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    gradient: string;
  };
}

export const themes: Record<string, Theme> = {
  dark: {
    name: "dark",
    label: "深色",
    colors: {
      primary: "#6366f1",
      primaryHover: "#4f46e5",
      primaryLight: "rgba(99, 102, 241, 0.15)",
      success: "#10b981",
      successLight: "rgba(16, 185, 129, 0.15)",
      danger: "#ef4444",
      dangerLight: "rgba(239, 68, 68, 0.15)",
      bg: "#0f172a",
      bgCard: "#1e293b",
      bgInput: "#334155",
      text: "#f1f5f9",
      textSecondary: "#94a3b8",
      textMuted: "#64748b",
      border: "#334155",
      gradient: "linear-gradient(135deg, #0f172a 0%, #1a1a2e 100%)",
    },
  },
  light: {
    name: "light",
    label: "浅色",
    colors: {
      primary: "#6366f1",
      primaryHover: "#4f46e5",
      primaryLight: "rgba(99, 102, 241, 0.1)",
      success: "#10b981",
      successLight: "rgba(16, 185, 129, 0.1)",
      danger: "#ef4444",
      dangerLight: "rgba(239, 68, 68, 0.1)",
      bg: "#f8fafc",
      bgCard: "#ffffff",
      bgInput: "#f1f5f9",
      text: "#1e293b",
      textSecondary: "#64748b",
      textMuted: "#94a3b8",
      border: "#e2e8f0",
      gradient: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
    },
  },
  purple: {
    name: "purple",
    label: "紫色",
    colors: {
      primary: "#a855f7",
      primaryHover: "#9333ea",
      primaryLight: "rgba(168, 85, 247, 0.15)",
      success: "#22c55e",
      successLight: "rgba(34, 197, 94, 0.15)",
      danger: "#f43f5e",
      dangerLight: "rgba(244, 63, 94, 0.15)",
      bg: "#1a1025",
      bgCard: "#2d1f3d",
      bgInput: "#3d2d52",
      text: "#f5f3ff",
      textSecondary: "#c4b5fd",
      textMuted: "#8b7faa",
      border: "#3d2d52",
      gradient: "linear-gradient(135deg, #1a1025 0%, #2d1f3d 100%)",
    },
  },
  ocean: {
    name: "ocean",
    label: "海洋",
    colors: {
      primary: "#06b6d4",
      primaryHover: "#0891b2",
      primaryLight: "rgba(6, 182, 212, 0.15)",
      success: "#10b981",
      successLight: "rgba(16, 185, 129, 0.15)",
      danger: "#f43f5e",
      dangerLight: "rgba(244, 63, 94, 0.15)",
      bg: "#0c1222",
      bgCard: "#162032",
      bgInput: "#1e2d44",
      text: "#ecfeff",
      textSecondary: "#67e8f9",
      textMuted: "#5e8aa8",
      border: "#1e2d44",
      gradient: "linear-gradient(135deg, #0c1222 0%, #0a1628 100%)",
    },
  },
  sunset: {
    name: "sunset",
    label: "日落",
    colors: {
      primary: "#f97316",
      primaryHover: "#ea580c",
      primaryLight: "rgba(249, 115, 22, 0.15)",
      success: "#22c55e",
      successLight: "rgba(34, 197, 94, 0.15)",
      danger: "#ef4444",
      dangerLight: "rgba(239, 68, 68, 0.15)",
      bg: "#1c1017",
      bgCard: "#2b1a24",
      bgInput: "#3d2535",
      text: "#fef2f2",
      textSecondary: "#fca5a5",
      textMuted: "#a87882",
      border: "#3d2535",
      gradient: "linear-gradient(135deg, #1c1017 0%, #2b1a24 100%)",
    },
  },
};

export const defaultTheme = "dark";
