/** ゲスト注文のセット選択（stepId → 選んだ単品 id の配列） */
export type GuestSetStepSelection = { stepId: string; menuItemIds: string[] };

export type SetStepForValidation = {
  id: string;
  label: string;
  minPick: number;
  maxPick: number;
  /** 各候補の上乗せは税抜円（会計時に店舗税率で税込換算） */
  choices: { componentMenuItemId: string; extraPrice: number }[];
};

export function validateSetSelections(
  steps: SetStepForValidation[],
  selections: GuestSetStepSelection[],
): { ok: true; byStep: Map<string, string[]> } | { ok: false; error: string } {
  const byStep = new Map<string, string[]>();
  for (const s of selections) {
    if (!s.stepId || !Array.isArray(s.menuItemIds)) {
      return { ok: false, error: "invalid setSelections shape" };
    }
    byStep.set(s.stepId, s.menuItemIds);
  }
  if (byStep.size !== steps.length) {
    return { ok: false, error: "setSelections must include every step once" };
  }
  for (const st of steps) {
    const ids = byStep.get(st.id);
    if (!ids) return { ok: false, error: "missing step in setSelections" };
    const n = ids.length;
    if (n < st.minPick || n > st.maxPick) {
      return { ok: false, error: `pick count out of range for step: ${st.label}` };
    }
    const uniq = new Set(ids);
    if (uniq.size !== ids.length) {
      return { ok: false, error: `duplicate pick in step: ${st.label}` };
    }
    const allowed = new Map(st.choices.map((c) => [c.componentMenuItemId, c.extraPrice]));
    for (const mid of ids) {
      if (!allowed.has(mid)) {
        return { ok: false, error: `invalid choice for step: ${st.label}` };
      }
    }
  }
  return { ok: true, byStep };
}

/** 候補の extraPrice（税抜円）を店舗税率で税込に換算し、選んだ分の上乗せ税込合計 */
export function surchargeExclusiveStepSumInclusive(
  step: SetStepForValidation,
  pickedIds: string[],
  taxRatePercent: number,
): number {
  const byId = new Map(step.choices.map((c) => [c.componentMenuItemId, c.extraPrice]));
  let sum = 0;
  for (const id of pickedIds) {
    const ex = byId.get(id) ?? 0;
    sum += Math.round(ex * (1 + taxRatePercent / 100));
  }
  return sum;
}

export function buildSetLineExtra(
  steps: { id: string; label: string }[],
  byStep: Map<string, string[]>,
  nameByComponentId: Map<string, string>,
  stepDefs: SetStepForValidation[],
  taxRatePercent: number,
): Record<string, unknown> {
  const outSteps: Record<string, unknown>[] = [];
  const byDef = new Map(stepDefs.map((s) => [s.id, s]));
  for (const st of steps) {
    const picked = byStep.get(st.id) ?? [];
    const def = byDef.get(st.id);
    const picks = picked.map((menuItemId) => {
      let ex = 0;
      if (def) {
        const row = def.choices.find((c) => c.componentMenuItemId === menuItemId);
        ex = row?.extraPrice ?? 0;
      }
      const surchargeInclusiveYen = Math.round(ex * (1 + taxRatePercent / 100));
      return {
        menuItemId,
        name: nameByComponentId.get(menuItemId) ?? "",
        extraPriceExclusiveYen: ex,
        surchargeInclusiveYen,
      };
    });
    outSteps.push({ stepId: st.id, label: st.label, picks });
  }
  return { kind: "set", steps: outSteps };
}

export function buildSetNameSnapshot(setName: string, lineExtra: Record<string, unknown>): string {
  const steps = lineExtra.steps;
  if (!Array.isArray(steps) || steps.length === 0) return setName;
  const parts: string[] = [];
  for (const row of steps) {
    if (!row || typeof row !== "object") continue;
    const label = typeof (row as { label?: string }).label === "string" ? (row as { label: string }).label : "";
    const picks = (row as { picks?: { name?: string }[] }).picks;
    const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
    if (label && names.length) parts.push(`${label}:${names.join("・")}`);
    else if (names.length) parts.push(names.join("・"));
  }
  if (parts.length === 0) return setName;
  return `${setName}［${parts.join(" / ")}］`;
}
