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
