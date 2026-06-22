import { createHmac, timingSafeEqual } from "node:crypto";
import { jwtSecret } from "../config.js";

function hubSecret(): string {
  const s = process.env.GAMES_HUB_SECRET;
  if (s && s.length >= 16) return s;
  return jwtSecret();
}

/** ゲームハブ用 URL クエリ `key`（店舗ごとに固定） */
export function gamesHubKeyForStore(storeId: string): string {
  return createHmac("sha256", hubSecret())
    .update(`games-hub:${storeId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyGamesHubKey(storeId: string, key: string): boolean {
  if (!storeId || !key) return false;
  const expected = gamesHubKeyForStore(storeId);
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
