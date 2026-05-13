import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  isSuperadmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AdminAuthState {
  user: AdminUser | null;
  loading: boolean;
  /** Re-fetch /api/admin/auth/me. Useful after a profile update. */
  refresh: () => Promise<AdminUser | null>;
  /** POST /api/admin/auth/login. Returns the user on success or throws. */
  login: (email: string, password: string) => Promise<AdminUser>;
  /** POST /api/admin/auth/logout, then navigate to /admin/login. */
  logout: () => Promise<void>;
}

const Ctx = createContext<AdminAuthState | undefined>(undefined);

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL).replace(/\/$/, "");

async function fetchMe(): Promise<AdminUser | null> {
  try {
    const res = await fetch(`${BASE}/api/admin/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.user as AdminUser) ?? null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  const refresh = useCallback(async () => {
    const u = await fetchMe();
    setUser(u);
    return u;
  }, []);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((u) => {
        if (!alive) return;
        setUser(u);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${BASE}/api/admin/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? "Login failed");
      }
      const u = json.user as AdminUser;
      setUser(u);
      return u;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE}/api/admin/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // best-effort
    }
    setUser(null);
    // Drop the legacy session-storage placeholder so a stale token
    // doesn't survive sign-out.
    try {
      sessionStorage.removeItem("ema-admin-token");
    } catch {
      /* ignore */
    }
    setLocation("/admin/login");
  }, [setLocation]);

  const value = useMemo<AdminAuthState>(
    () => ({ user, loading, refresh, login, logout }),
    [user, loading, refresh, login, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuthState {
  const v = useContext(Ctx);
  if (!v)
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return v;
}

/**
 * Wrap any protected admin route with this component. While the
 * session lookup is in flight we render a tiny placeholder; if the
 * lookup returns no user we redirect to /admin/login (preserving the
 * intended destination as a `?next=` query so we can bounce back).
 */
export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAdminAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(location);
      setLocation(`/admin/login?next=${next}`);
    }
  }, [loading, user, location, setLocation]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-muted-foreground"
        data-testid="admin-auth-loading"
      >
        Loading…
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
