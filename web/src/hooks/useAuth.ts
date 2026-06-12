import { useState, useCallback } from "react";

const STORAGE_KEY = "echolink-auth";

export interface AuthUser {
  userId: number;
  username: string;
  displayName: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

function getApiBaseUrl(): string {
  const protocol = window.location.protocol;
  const host = window.location.host;
  return `${protocol}//${host}`;
}

function loadStoredAuth(): { user: AuthUser | null; token: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, token: null };
    const parsed = JSON.parse(raw);
    if (parsed.token && parsed.user) {
      return { user: parsed.user, token: parsed.token };
    }
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore environments without localStorage (e.g. some test setups).
    }
  }
  return { user: null, token: null };
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => ({
    ...loadStoredAuth(),
    loading: false,
    error: null,
  }));

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const storeAuth = useCallback((user: AuthUser, token: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }));
    setState({ user, token, loading: false, error: null });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, token: null, loading: false, error: null });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState((prev) => ({ ...prev, loading: false, error: data.error || "登录失败" }));
        return false;
      }
      storeAuth(data.user, data.token);
      return true;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "登录失败",
      }));
      return false;
    }
  }, [storeAuth]);

  const register = useCallback(
    async (username: string, password: string, displayName?: string): Promise<boolean> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, displayName }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState((prev) => ({ ...prev, loading: false, error: data.error || "注册失败" }));
          return false;
        }
        storeAuth(data.user, data.token);
        return true;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "注册失败",
        }));
        return false;
      }
    },
    [storeAuth]
  );

  return {
    user: state.user,
    token: state.token,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    clearError,
  };
}
