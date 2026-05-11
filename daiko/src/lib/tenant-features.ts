import type { PlanTier } from "@prisma/client";
import { prisma } from "../db.js";
import { featureEnabled, mergePlanFeatures } from "./plan-features.js";

export async function getActivePlanTier(tenantId: string): Promise<PlanTier> {
  const now = new Date();
  const sub = await prisma.subscription.findFirst({
    where: {
      tenantId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
    },
    orderBy: { validFrom: "desc" },
  });
  return sub?.planTier ?? "FREE";
}

export async function getMergedFeaturesForTenant(tenantId: string): Promise<Record<string, boolean>> {
  const [tier, settings] = await Promise.all([
    getActivePlanTier(tenantId),
    prisma.tenantSettings.findUnique({ where: { tenantId } }),
  ]);
  const flags = (settings?.featureFlags as Record<string, unknown> | undefined) ?? {};
  return mergePlanFeatures(tier, flags);
}

export async function tenantFeatureEnabled(tenantId: string, key: string): Promise<boolean> {
  const merged = await getMergedFeaturesForTenant(tenantId);
  return featureEnabled(merged, key);
}
