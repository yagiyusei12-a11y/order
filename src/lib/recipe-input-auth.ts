import { createHmac, timingSafeEqual } from "node:crypto";
import { jwtSecret } from "../config.js";

function secret(): string {
  const s = process.env.RECIPE_INPUT_SECRET;
  if (s && s.length >= 16) return s;
  return jwtSecret();
}

/** レシピ一括入力用 URL クエリ `key`（店舗ごとに固定） */
export function recipeInputKeyForStore(storeId: string): string {
  return createHmac("sha256", secret())
    .update(`recipe-input:${storeId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyRecipeInputKey(storeId: string, key: string): boolean {
  if (!storeId || !key) return false;
  const expected = recipeInputKeyForStore(storeId);
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
