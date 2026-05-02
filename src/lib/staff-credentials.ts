/** メールはログイン照合で小文字化して保存・検索する */
export function normalizeStaffEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const RESERVED_STORE_IDS = new Set(["login", "setup"]);

/** スタッフ URL `/staff-app/<id>/...` 用の店舗 ID（英小文字・数字・-_・2〜64文字） */
export function parseStoreId(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,64}$/.test(s)) return null;
  if (RESERVED_STORE_IDS.has(s)) return null;
  return s;
}

export function validatePasswordPlain(p: string): string | null {
  if (p.length < 8) return "パスワードは8文字以上にしてください";
  return null;
}
