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
