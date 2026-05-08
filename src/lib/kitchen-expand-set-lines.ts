/** lineExtra（kind: set）から構成単品一覧を取り出す（キッチン表示用） */
export type SetComponentPick = {
  menuItemId: string;
  pickName: string;
  stepLabel: string;
};

export function extractSetComponentsFromLineExtra(lineExtra: unknown): SetComponentPick[] {
  if (lineExtra == null || typeof lineExtra !== "object") return [];
  const o = lineExtra as Record<string, unknown>;
  if (o.kind !== "set" || !Array.isArray(o.steps)) return [];
  const byId = new Map<string, SetComponentPick>();
  for (const st of o.steps) {
    if (!st || typeof st !== "object") continue;
    const stepLabel =
      typeof (st as { label?: string }).label === "string" ? (st as { label: string }).label.trim() : "";
    const picks = (st as { picks?: unknown }).picks;
    if (!Array.isArray(picks)) continue;
    for (const p of picks) {
      if (!p || typeof p !== "object") continue;
      const menuItemId =
        typeof (p as { menuItemId?: string }).menuItemId === "string"
          ? (p as { menuItemId: string }).menuItemId.trim()
          : "";
      if (!menuItemId) continue;
      const pickNameRaw =
        typeof (p as { name?: string }).name === "string" ? (p as { name: string }).name.trim() : "";
      const pickName = pickNameRaw || "（名称未設定）";
      const prev = byId.get(menuItemId);
      if (prev) {
        if (stepLabel && !prev.stepLabel.includes(stepLabel)) {
          prev.stepLabel = prev.stepLabel ? `${prev.stepLabel}・${stepLabel}` : stepLabel;
        }
      } else {
        byId.set(menuItemId, { menuItemId, pickName, stepLabel });
      }
    }
  }
  return [...byId.values()];
}

/** nameSnapshot からセット名（［内訳］より前）を取る（キッチン表示用） */
export function stripSetNameSnapshotBracket(nameSnapshot: string): string {
  const s = String(nameSnapshot || "");
  const i1 = s.indexOf("［");
  const i2 = s.indexOf("[");
  const cut = i1 >= 0 && i2 >= 0 ? Math.min(i1, i2) : i1 >= 0 ? i1 : i2 >= 0 ? i2 : -1;
  return (cut >= 0 ? s.slice(0, cut) : s).trim();
}

/** キッチン用: 構成単品ごとの調理済み（親 OrderLine.lineExtra に保存）。未定義なら従来どおり親 status のみ */
export function readKitDonePartIds(lineExtra: unknown): string[] | undefined {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(lineExtra, "kitDonePartIds")) return undefined;
  const v = (lineExtra as Record<string, unknown>).kitDonePartIds;
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
}

/** kitDonePartIds をマージ（null でキー削除＝従来表示に戻す） */
export function applyKitDonePartIdsToLineExtra(
  lineExtra: unknown,
  partIds: string[] | null,
): Record<string, unknown> {
  const base =
    lineExtra != null && typeof lineExtra === "object" && !Array.isArray(lineExtra)
      ? { ...(lineExtra as Record<string, unknown>) }
      : {};
  if (partIds === null) {
    delete base.kitDonePartIds;
  } else {
    base.kitDonePartIds = partIds;
  }
  return base;
}

/** 展開行の表示用 status（親は queued のまま、単品だけ done にできる） */
export function deriveSetComponentRowStatus(
  parentStatus: string,
  lineExtra: unknown,
  componentMenuItemId: string,
): string {
  const tracked = readKitDonePartIds(lineExtra);
  if (tracked === undefined) {
    return parentStatus;
  }
  const done = new Set(tracked);
  if (done.has(componentMenuItemId)) return "done";
  if (parentStatus === "served" || parentStatus === "cancelled") return parentStatus;
  if (parentStatus === "done") return "done";
  return parentStatus;
}
