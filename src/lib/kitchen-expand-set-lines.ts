/** lineExtra（kind: set）から構成単品一覧を取り出す（キッチン表示用） */
export type SetComponentPick = {
  menuItemId: string;
  pickName: string;
  stepLabel: string;
  /** 構成単品に付いたオプション（kind: single の lineExtra スナップショット） */
  optionSubtext: string;
};

/** kind: single のオプション選択をキッチン表示用テキストに（1行 or 複数行） */
export function formatSingleKindOptionSubtext(lineExtra: unknown): string {
  if (lineExtra == null || typeof lineExtra !== "object") return "";
  const o = lineExtra as Record<string, unknown>;
  if (o.kind !== "single" || !Array.isArray(o.options)) return "";
  const lines: string[] = [];
  for (const gr of o.options) {
    if (!gr || typeof gr !== "object") continue;
    const gn =
      typeof (gr as { groupName?: string }).groupName === "string"
        ? (gr as { groupName: string }).groupName
        : "";
    const picks = (gr as { picks?: { name?: string }[] }).picks;
    const names = Array.isArray(picks)
      ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean)
      : [];
    if (gn && names.length) lines.push(gn + ": " + names.join("・"));
    else if (names.length) lines.push(names.join("・"));
  }
  return lines.join("\n");
}

export function formatSetComponentPickDisplayName(pickName: string, optionSubtext: string): string {
  const base = String(pickName || "").trim() || "（名称未設定）";
  const opt = String(optionSubtext || "").trim();
  if (!opt) return base;
  return base + "（" + opt.replace(/\n/g, " / ") + "）";
}

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
      const optionSubtext = formatSingleKindOptionSubtext(
        (p as { optionExtra?: unknown }).optionExtra,
      );
      const prev = byId.get(menuItemId);
      if (prev) {
        if (stepLabel && !prev.stepLabel.includes(stepLabel)) {
          prev.stepLabel = prev.stepLabel ? `${prev.stepLabel}・${stepLabel}` : stepLabel;
        }
        if (optionSubtext && optionSubtext !== prev.optionSubtext) {
          prev.optionSubtext = prev.optionSubtext
            ? `${prev.optionSubtext}\n${optionSubtext}`
            : optionSubtext;
        }
      } else {
        byId.set(menuItemId, { menuItemId, pickName, stepLabel, optionSubtext });
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

/** kitDonePartIds 用キー（同一セットを複数食注文したときは食目ごとに分ける） */
export function formatSetPartDoneKey(
  menuItemId: string,
  instanceIndex: number,
  instanceCount: number,
): string {
  const id = String(menuItemId || "").trim();
  if (!id) return "";
  if (instanceCount <= 1) return id;
  const inst = Math.max(1, Math.floor(instanceIndex));
  return `i${inst}:${id}`;
}

/** kitDonePartIds のエントリを分解（旧形式は menuItemId のみ） */
export function parseSetPartDoneKey(entry: string): { instanceIndex: number | null; menuItemId: string } {
  const s = String(entry || "").trim();
  const m = /^i(\d+):(.+)$/.exec(s);
  if (m) return { instanceIndex: Number(m[1]), menuItemId: m[2] };
  return { instanceIndex: null, menuItemId: s };
}

function isSetPartDoneInTracked(
  tracked: Set<string>,
  menuItemId: string,
  instanceIndex: number,
  instanceCount: number,
): boolean {
  const key = formatSetPartDoneKey(menuItemId, instanceIndex, instanceCount);
  if (tracked.has(key)) return true;
  // 複数食導入前のデータ: 素の menuItemId は 1 食目のみ調理済み扱い
  if (instanceCount > 1 && instanceIndex === 1 && tracked.has(menuItemId)) return true;
  return false;
}

/** 親行のセット食数と、全構成が調理済みか */
export function listSetPartDoneKeysForLine(
  componentMenuItemIds: string[],
  instanceCount: number,
): string[] {
  const qty = Math.max(1, instanceCount);
  const keys: string[] = [];
  for (let inst = 1; inst <= qty; inst++) {
    for (const menuItemId of componentMenuItemIds) {
      keys.push(formatSetPartDoneKey(menuItemId, inst, qty));
    }
  }
  return keys;
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
  instanceIndex = 1,
  instanceCount = 1,
): string {
  const tracked = readKitDonePartIds(lineExtra);
  if (tracked === undefined) {
    return parentStatus;
  }
  const done = new Set(tracked);
  if (isSetPartDoneInTracked(done, componentMenuItemId, instanceIndex, instanceCount)) return "done";
  if (parentStatus === "served" || parentStatus === "cancelled") return parentStatus;
  if (parentStatus === "done") return "done";
  return parentStatus;
}
