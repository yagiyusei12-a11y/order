/**
 * レシピ本文とレンジ分数の合体／分解。
 * マスタには `MenuItem.recipe` のみ保存し、先頭行 `【レンジ】N分` で表現する。
 */

const RANGE_LINE_RE = /^【レンジ】\s*(\d+(?:\.\d+)?)\s*分\s*(?:\r?\n|$)/;

export type ParsedRecipeParts = {
  /** 空文字＝レンジ指定なし */
  rangeMinutes: string;
  body: string;
};

export function parseRecipeParts(recipe: string | null | undefined): ParsedRecipeParts {
  const raw = typeof recipe === "string" ? recipe : "";
  const m = RANGE_LINE_RE.exec(raw);
  if (!m) {
    return { rangeMinutes: "", body: raw };
  }
  return {
    rangeMinutes: m[1],
    body: raw.slice(m[0].length).replace(/^\r?\n/, ""),
  };
}

/** 入力値を正規化。不正・空は "" */
export function normalizeRangeMinutesInput(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (!/^\d+(?:\.\d+)?$/.test(s)) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 999) return "";
  // 整数なら整数表記、小数は余分な0を落とす
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

export function composeRecipeText(rangeMinutes: string | null | undefined, body: string | null | undefined): string | null {
  const range = normalizeRangeMinutesInput(rangeMinutes ?? "");
  const bodyText = typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
  // 本文先頭に古い【レンジ】行があれば除去してから付け直す
  const cleanedBody = bodyText.replace(RANGE_LINE_RE, "").replace(/^\r?\n/, "");
  const parts: string[] = [];
  if (range) parts.push(`【レンジ】${range}分`);
  if (cleanedBody.trim()) parts.push(cleanedBody.replace(/\s+$/, ""));
  if (parts.length === 0) return null;
  return parts.join("\n");
}

export function recipeHasContent(rangeMinutes: string, body: string): boolean {
  return !!(normalizeRangeMinutesInput(rangeMinutes) || String(body || "").trim());
}
