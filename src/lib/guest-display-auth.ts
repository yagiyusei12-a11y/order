import { createHmac, timingSafeEqual } from "node:crypto";
import { jwtSecret } from "../config.js";

function displaySecret(): string {
  const s = process.env.GUEST_DISPLAY_SECRET;
  if (s && s.length >= 16) return s;
  return jwtSecret();
}

/** 客面ディスプレイ用 URL クエリ `key`（店舗ごとに固定） */
export function guestDisplayKeyForStore(storeId: string): string {
  return createHmac("sha256", displaySecret())
    .update(`guest-display:${storeId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyGuestDisplayKey(storeId: string, key: string): boolean {
  if (!storeId || !key) return false;
  const expected = guestDisplayKeyForStore(storeId);
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
