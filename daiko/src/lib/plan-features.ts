import type { PlanTier } from "@prisma/client";

/** プラン既定のブール機能（TenantSettings.featureFlags で上書き可） */
const PLAN_DEFAULTS: Record<PlanTier, Record<string, boolean>> = {
  FREE: {
    pdfExport: false,
    payrollReopen: false,
    dashboard: true,
    legalStubs: true,
  },
  STANDARD: {
    pdfExport: true,
    payrollReopen: true,
    dashboard: true,
    legalStubs: true,
  },
  PREMIUM: {
    pdfExport: true,
    payrollReopen: true,
    dashboard: true,
    legalStubs: true,
  },
};

export function mergePlanFeatures(
  planTier: PlanTier,
  featureFlags: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  const base = { ...PLAN_DEFAULTS[planTier] };
  if (!featureFlags || typeof featureFlags !== "object") return base;
  for (const [k, v] of Object.entries(featureFlags)) {
    if (typeof v === "boolean") base[k] = v;
  }
  return base;
}

export function featureEnabled(merged: Record<string, boolean>, key: string): boolean {
  return merged[key] === true;
}
