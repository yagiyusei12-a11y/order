const API = "/api/v1";

const TOKEN_KEY = "daiko_access";
const REFRESH_KEY = "daiko_refresh";

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  sessionStorage.setItem(TOKEN_KEY, access);
  sessionStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
}

async function tryRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  const res = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) return false;
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const { json, headers: hdr, ...rest } = init;
  const headers = new Headers(hdr);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(json);
  }

  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  let res = await fetch(url, { ...rest, headers });

  if (res.status === 401 && !url.includes("/auth/refresh")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const h2 = new Headers(hdr);
      const t2 = getAccessToken();
      if (t2) h2.set("Authorization", `Bearer ${t2}`);
      if (json !== undefined) h2.set("Content-Type", "application/json");
      res = await fetch(url, { ...rest, headers: h2, body: json !== undefined ? JSON.stringify(json) : rest.body });
    }
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    return { ok: false, status: res.status, error: err };
  }
  return { ok: true, data: body as T };
}

/** PDF などバイナリ。401 時は refresh して 1 回だけ再試行。 */
export async function apiFetchBlob(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ ok: true; blob: Blob; filename?: string } | { ok: false; status: number; error: string }> {
  const { json, headers: hdr, ...rest } = init;
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;

  const doFetch = (): Promise<Response> => {
    const headers = new Headers(hdr);
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (json !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, {
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  };

  let res = await doFetch();
  if (res.status === 401 && !url.includes("/auth/refresh")) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    const text = await res.text();
    let err = res.statusText;
    try {
      const o = JSON.parse(text) as { error?: string };
      if (o?.error) err = String(o.error);
    } catch {
      if (text && text.length < 400) err = text;
    }
    return { ok: false, status: res.status, error: err };
  }

  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const blob = await res.blob();
  return { ok: true, blob, filename: m?.[1] };
}
