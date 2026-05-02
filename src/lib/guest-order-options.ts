/** ゲスト注文 JSON: オプショングループごとの選択 */
export type GuestOptionGroupSelection = { optionGroupId: string; optionItemIds: string[] };

type OptionGroupForOrder = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  items: { id: string; name: string; priceDelta: number }[];
};

function selectionMap(raw: unknown): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (!Array.isArray(raw)) return m;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const gid = (row as { optionGroupId?: unknown }).optionGroupId;
    const ids = (row as { optionItemIds?: unknown }).optionItemIds;
    if (typeof gid !== "string" || !gid) continue;
    if (!Array.isArray(ids)) {
      m.set(gid, []);
      continue;
    }
    const clean = ids.filter((x): x is string => typeof x === "string" && x.length > 0);
    m.set(gid, clean);
  }
  return m;
}

/** 各リンク済みグループについて選択数・ID妥当性を検証 */
export function validateGuestOptionSelections(
  linkedGroups: OptionGroupForOrder[],
  rawSelections: unknown,
): { ok: true; byGroup: Map<string, string[]> } | { ok: false; error: string } {
  const incoming = selectionMap(rawSelections);
  const byGroup = new Map<string, string[]>();
  for (const g of linkedGroups) {
    const picked = incoming.has(g.id) ? [...new Set(incoming.get(g.id)!)] : [];
    const allowed = new Set(g.items.map((i) => i.id));
    for (const id of picked) {
      if (!allowed.has(id)) {
        return { ok: false, error: `invalid option item for group ${g.name}` };
      }
    }
    const n = picked.length;
    if (n < g.minSelect || n > g.maxSelect) {
      return { ok: false, error: `option count out of range for group: ${g.name}` };
    }
    byGroup.set(g.id, picked);
  }
  return { ok: true, byGroup };
}

/** priceDelta は税込の商品単価への加算（円）として合算 */
export function sumInclusiveOptionPriceDelta(
  linkedGroups: OptionGroupForOrder[],
  byGroup: Map<string, string[]>,
): number {
  let sum = 0;
  for (const g of linkedGroups) {
    const ids = byGroup.get(g.id) ?? [];
    const byId = new Map(g.items.map((i) => [i.id, i]));
    for (const id of ids) {
      sum += byId.get(id)?.priceDelta ?? 0;
    }
  }
  return sum;
}

export function buildSingleOptionsLineExtra(
  linkedGroups: OptionGroupForOrder[],
  byGroup: Map<string, string[]>,
): Record<string, unknown> {
  const options: Record<string, unknown>[] = [];
  for (const g of linkedGroups) {
    const ids = byGroup.get(g.id) ?? [];
    if (ids.length === 0) continue;
    const byId = new Map(g.items.map((i) => [i.id, i]));
    const picks = ids.map((optionItemId) => {
      const it = byId.get(optionItemId);
      return {
        optionItemId,
        name: it?.name ?? "",
        priceDelta: it?.priceDelta ?? 0,
      };
    });
    options.push({ groupId: g.id, groupName: g.name, picks });
  }
  return { kind: "single", options };
}

export function buildSingleNameSnapshotWithOptions(
  itemName: string,
  lineExtra: Record<string, unknown>,
): string {
  const opts = lineExtra.options;
  if (!Array.isArray(opts) || opts.length === 0) return itemName;
  const parts: string[] = [];
  for (const row of opts) {
    if (!row || typeof row !== "object") continue;
    const gn = typeof (row as { groupName?: string }).groupName === "string" ? (row as { groupName: string }).groupName : "";
    const picks = (row as { picks?: { name?: string }[] }).picks;
    const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
    if (names.length) parts.push(names.join("・"));
  }
  if (parts.length === 0) return itemName;
  return `${itemName}［${parts.join(" / ")}］`;
}
