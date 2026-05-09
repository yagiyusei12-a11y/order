import { extractSetComponentsFromLineExtra } from "./kitchen-expand-set-lines.js";

export const SET_SERVE_LATER_LINE_KIND = "set_serve_later";

/** セットの「後出し」子行がゲスト操作でキッチンに送られるまでの保留状態（キッチン一覧には出さない） */
export const ORDER_LINE_STATUS_GUEST_DEFERRED = "guest_deferred";

export function readBundleId(lineExtra: unknown): string | null {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return null;
  const b = (lineExtra as Record<string, unknown>).bundleId;
  return typeof b === "string" && b.trim() ? b.trim() : null;
}

export function isSetServeLaterLine(lineExtra: unknown): boolean {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return false;
  return (lineExtra as Record<string, unknown>).kind === SET_SERVE_LATER_LINE_KIND;
}

/** 親セット行か（bundle 分割時） */
export function isBundledSetParentLine(lineExtra: unknown): boolean {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return false;
  const o = lineExtra as Record<string, unknown>;
  return o.kind === "set" && typeof o.bundleId === "string" && o.bundleId.length > 0;
}

/** バンドルに含まれる在庫キー（セット1 + 構成単品）と注文あたりの個数 */
export function collectBundleStockDecrements(
  parentLineExtra: unknown,
  parentSetMenuItemId: string,
  parentQty: number,
  childLines: { menuItemId: string | null; qty: number; lineExtra: unknown }[],
): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string, q: number) => {
    if (!id || q <= 0) return;
    m.set(id, (m.get(id) ?? 0) + q);
  };
  add(parentSetMenuItemId, parentQty);
  for (const p of extractSetComponentsFromLineExtra(parentLineExtra)) {
    add(p.menuItemId, parentQty);
  }
  for (const ch of childLines) {
    if (isSetServeLaterLine(ch.lineExtra) && ch.menuItemId) {
      add(ch.menuItemId, ch.qty);
    }
  }
  return m;
}
