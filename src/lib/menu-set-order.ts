/** ゲスト注文のセット選択（stepId → 選んだ単品 id の配列） */
export type GuestSetStepSelection = { stepId: string; menuItemIds: string[] };

export type SetStepForValidation = {
  id: string;
  label: string;
  minPick: number;
  maxPick: number;
  /** 各候補の上乗せは税抜円（会計時に店舗税率で税込換算）。isFixed はゲストが選ばず常に含める */
  choices: { componentMenuItemId: string; extraPrice: number; isFixed?: boolean }[];
};

export function validateSetSelections(
  steps: SetStepForValidation[],
  selections: GuestSetStepSelection[],
): { ok: true; byStep: Map<string, string[]> } | { ok: false; error: string } {
  const byStepInput = new Map<string, string[]>();
  for (const s of selections) {
    if (!s.stepId || !Array.isArray(s.menuItemIds)) {
      return { ok: false, error: "invalid setSelections shape" };
    }
    byStepInput.set(s.stepId, s.menuItemIds);
  }
  if (byStepInput.size !== steps.length) {
    return { ok: false, error: "setSelections must include every step once" };
  }

  const mergedByStep = new Map<string, string[]>();
  for (const st of steps) {
    const userIds = byStepInput.get(st.id);
    if (!userIds) return { ok: false, error: "missing step in setSelections" };

    const fixedIds = st.choices.filter((c) => c.isFixed === true).map((c) => c.componentMenuItemId);
    const pickableSet = new Set(st.choices.filter((c) => !c.isFixed).map((c) => c.componentMenuItemId));

    const n = userIds.length;
    if (n < st.minPick || n > st.maxPick) {
      return { ok: false, error: `pick count out of range for step: ${st.label}` };
    }
    const uniq = new Set(userIds);
    if (uniq.size !== userIds.length) {
      return { ok: false, error: `duplicate pick in step: ${st.label}` };
    }
    for (const mid of userIds) {
      if (!pickableSet.has(mid)) {
        return { ok: false, error: `invalid choice for step: ${st.label}` };
      }
    }
    const merged = [...fixedIds, ...userIds];
    const mergedUniq = new Set(merged);
    if (mergedUniq.size !== merged.length) {
      return { ok: false, error: `duplicate component in step: ${st.label}` };
    }
    mergedByStep.set(st.id, merged);
  }
  return { ok: true, byStep: mergedByStep };
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
    const pickedUser = byStep.get(st.id) ?? [];
    const def = byDef.get(st.id);
    const fixedIds = def ? def.choices.filter((c) => c.isFixed === true).map((c) => c.componentMenuItemId) : [];
    // lineExtra は「選択内容のスナップショット」なので、呼び出し元が fixed を混ぜ忘れても必ず含める
    const picked = [...new Set([...fixedIds, ...pickedUser])];
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

/** 指定ステップを lineExtra から除く（後出し別明細用。金額計算は元の byStep のまま） */
export function buildSetLineExtraOmitStepIds(
  steps: { id: string; label: string }[],
  byStep: Map<string, string[]>,
  nameByComponentId: Map<string, string>,
  stepDefs: SetStepForValidation[],
  taxRatePercent: number,
  omitStepIds: Set<string>,
): Record<string, unknown> {
  const stepsFiltered = steps.filter((s) => !omitStepIds.has(s.id));
  const defsFiltered = stepDefs.filter((d) => !omitStepIds.has(d.id));
  const byFiltered = new Map<string, string[]>();
  for (const s of stepsFiltered) {
    byFiltered.set(s.id, byStep.get(s.id) ?? []);
  }
  return buildSetLineExtra(stepsFiltered, byFiltered, nameByComponentId, defsFiltered, taxRatePercent);
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
