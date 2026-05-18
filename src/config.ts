/** httpOnly Cookie に載せる JWT の名前（@fastify/jwt とログアウトで共通） */
export const STAFF_JWT_COOKIE_NAME = "access";

/** JWT 用。本番では必ず環境変数で上書きすること。 */
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!s || s.length < 24) {
      throw new Error("JWT_SECRET must be set to a random string of at least 24 characters in production");
    }
    return s;
  }
  return s || "dev-only-jwt-secret-min-32-characters-long";
}

export function cookieSecureDefault(): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return process.env.NODE_ENV === "production";
}

/** 店舗タブレット等：一度ログインした端末は長期間ログイン維持（ブラウザ Cookie 上限に合わせ 400 日） */
export const STAFF_JWT_EXPIRES_IN_DEFAULT = "400d";

/** JWT の expiresIn（jsonwebtoken 形式: 12h, 30d, 400d など） */
export function staffJwtExpiresIn(): string {
  const v = process.env.JWT_EXPIRES_IN?.trim();
  return v || STAFF_JWT_EXPIRES_IN_DEFAULT;
}

function parseDurationSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(years?|y|days?|d|hours?|h|minutes?|m|seconds?|s)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (m[2] || "s").toLowerCase();
  const unit = u.startsWith("y") ? "y" : u[0];
  const mult =
    unit === "y"
      ? 365 * 24 * 3600
      : unit === "d"
        ? 24 * 3600
        : unit === "h"
          ? 3600
          : unit === "m"
            ? 60
            : 1;
  return Math.floor(n * mult);
}

/** httpOnly Cookie の maxAge（秒）。JWT と揃える（JWT_COOKIE_MAX_AGE_SECONDS で上書き可） */
export function staffJwtCookieMaxAgeSeconds(): number {
  const explicit = process.env.JWT_COOKIE_MAX_AGE_SECONDS?.trim();
  if (explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const parsed = parseDurationSeconds(staffJwtExpiresIn());
  if (parsed != null) return parsed;
  return parseDurationSeconds(STAFF_JWT_EXPIRES_IN_DEFAULT) ?? 400 * 24 * 3600;
}
