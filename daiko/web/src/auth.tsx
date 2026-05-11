import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, clearTokens, getAccessToken, setTokens } from "./api";

export type MeUser = {
  id: string;
  email: string;
  displayName: string | null;
  tenant: { id: string; name: string; slug: string };
  roles: string[];
  permissions: string[];
};

type AuthCtx = {
  me: MeUser | null;
  loading: boolean;
  refreshMe: () => Promise<void>;
  login: (slug: string, email: string, password: string) => Promise<string | undefined>;
  register: (p: {
    tenantName: string;
    slug: string;
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<string | undefined>;
  logout: () => void;
  can: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(Boolean(getAccessToken()));

  const refreshMe = useCallback(async () => {
    if (!getAccessToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await apiFetch<{ user: MeUser | null }>("/me");
    setLoading(false);
    if (r.ok) setMe(r.data.user);
    else {
      clearTokens();
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (slug: string, email: string, password: string) => {
    const r = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/login", {
      method: "POST",
      json: { slug, email, password },
    });
    if (!r.ok) return r.error;
    setTokens(r.data.accessToken, r.data.refreshToken);
    await refreshMe();
    return undefined;
  }, [refreshMe]);

  const register = useCallback(
    async (p: {
      tenantName: string;
      slug: string;
      email: string;
      password: string;
      displayName?: string;
    }) => {
      const r = await apiFetch<{ accessToken: string; refreshToken: string }>("/auth/register", {
        method: "POST",
        json: p,
      });
      if (!r.ok) return r.error;
      setTokens(r.data.accessToken, r.data.refreshToken);
      await refreshMe();
      return undefined;
    },
    [refreshMe],
  );

  const logout = useCallback(() => {
    clearTokens();
    setMe(null);
  }, []);

  const can = useCallback(
    (perm: string) => {
      const p = me?.permissions ?? [];
      return p.includes("*") || p.includes(perm);
    },
    [me],
  );

  const value = useMemo(
    () => ({ me, loading, refreshMe, login, register, logout, can }),
    [me, loading, refreshMe, login, register, logout, can],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
