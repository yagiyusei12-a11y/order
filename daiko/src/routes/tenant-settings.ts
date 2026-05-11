import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, jwtUser } from "../auth/pre.js";
import { writeAuditEvent } from "../lib/audit.js";
import { userHasPermission } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";
import { validateDispatchProfileInCustomJson, validateDocumentFormsInCustomJson } from "../lib/dispatch-profile.js";

const patchBodySchema = z.object({
  businessDayRollHour: z.number().int().min(0).max(23).optional(),
  featureFlags: z.record(z.unknown()).optional(),
  customJson: z.record(z.unknown()).optional(),
  legalTradeName: z.string().max(500).nullable().optional(),
  legalRepresentativeName: z.string().max(200).nullable().optional(),
  legalBusinessAddress: z.string().max(2000).nullable().optional(),
  legalPhone: z.string().max(100).nullable().optional(),
  legalPublicSafetyCommission: z.string().max(500).nullable().optional(),
  legalCertificationNumber: z.string().max(200).nullable().optional(),
  legalCertificationDate: z.string().max(50).nullable().optional(),
  legalMainOfficeName: z.string().max(500).nullable().optional(),
  legalMainOfficeAddress: z.string().max(2000).nullable().optional(),
  legalSafetyManagerName: z.string().max(200).nullable().optional(),
  legalAlcoholDetectorModel: z.string().max(200).nullable().optional(),
  legalAlcoholInspectionDone: z.boolean().nullable().optional(),
  legalAlcoholInspectionDate: z.string().max(50).nullable().optional(),
  legalMutualAidOrganizationName: z.string().max(500).nullable().optional(),
  legalMutualAidContractFrom: z.string().max(50).nullable().optional(),
  legalMutualAidContractTo: z.string().max(50).nullable().optional(),
  legalBodilyCoverage: z.string().max(200).nullable().optional(),
  legalPropertyCoverage: z.string().max(200).nullable().optional(),
  legalVehicleCoverageLimitManYen: z.string().max(100).nullable().optional(),
});

function parseDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

export async function registerTenantSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tenant-settings", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const row = await prisma.tenantSettings.findUnique({ where: { tenantId: tid } });
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.patch<{
    Body: {
      businessDayRollHour?: number;
      featureFlags?: Record<string, unknown>;
      customJson?: Record<string, unknown>;
    };
  }>("/tenant-settings", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const allowed = await userHasPermission(u.sub, tid, "tenant.settings");
    if (!allowed) return reply.code(403).send({ error: "forbidden" });

    const parsed = patchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (!Object.keys(body).length) return reply.code(400).send({ error: "no fields to update" });

    if (body.customJson !== undefined) {
      const d = validateDispatchProfileInCustomJson(body.customJson);
      if (!d.ok) return reply.code(400).send({ error: d.error });
      const f = validateDocumentFormsInCustomJson(body.customJson);
      if (!f.ok) return reply.code(400).send({ error: f.error });
    }

    const flagsStr = body.featureFlags !== undefined ? JSON.stringify(body.featureFlags) : "";
    if (flagsStr.length > 32_000) return reply.code(400).send({ error: "featureFlags too large" });
    const customStr = body.customJson !== undefined ? JSON.stringify(body.customJson) : "";
    if (customStr.length > 64_000) return reply.code(400).send({ error: "customJson too large" });

    const legalCertificationDate = parseDateOrNull(body.legalCertificationDate);
    const legalAlcoholInspectionDate = parseDateOrNull(body.legalAlcoholInspectionDate);
    const legalMutualAidContractFrom = parseDateOrNull(body.legalMutualAidContractFrom);
    const legalMutualAidContractTo = parseDateOrNull(body.legalMutualAidContractTo);
    if (
      (body.legalCertificationDate !== undefined && legalCertificationDate === undefined) ||
      (body.legalAlcoholInspectionDate !== undefined && legalAlcoholInspectionDate === undefined) ||
      (body.legalMutualAidContractFrom !== undefined && legalMutualAidContractFrom === undefined) ||
      (body.legalMutualAidContractTo !== undefined && legalMutualAidContractTo === undefined)
    ) {
      return reply.code(400).send({ error: "invalid date format in legal settings" });
    }

    const updated = await prisma.tenantSettings.update({
      where: { tenantId: tid },
      data: {
        ...(body.businessDayRollHour !== undefined ? { businessDayRollHour: body.businessDayRollHour } : {}),
        ...(body.featureFlags !== undefined
          ? { featureFlags: body.featureFlags as Prisma.InputJsonValue }
          : {}),
        ...(body.customJson !== undefined ? { customJson: body.customJson as Prisma.InputJsonValue } : {}),
        ...(body.legalTradeName !== undefined ? { legalTradeName: body.legalTradeName?.trim() || null } : {}),
        ...(body.legalRepresentativeName !== undefined
          ? { legalRepresentativeName: body.legalRepresentativeName?.trim() || null }
          : {}),
        ...(body.legalBusinessAddress !== undefined
          ? { legalBusinessAddress: body.legalBusinessAddress?.trim() || null }
          : {}),
        ...(body.legalPhone !== undefined ? { legalPhone: body.legalPhone?.trim() || null } : {}),
        ...(body.legalPublicSafetyCommission !== undefined
          ? { legalPublicSafetyCommission: body.legalPublicSafetyCommission?.trim() || null }
          : {}),
        ...(body.legalCertificationNumber !== undefined
          ? { legalCertificationNumber: body.legalCertificationNumber?.trim() || null }
          : {}),
        ...(body.legalCertificationDate !== undefined ? { legalCertificationDate } : {}),
        ...(body.legalMainOfficeName !== undefined
          ? { legalMainOfficeName: body.legalMainOfficeName?.trim() || null }
          : {}),
        ...(body.legalMainOfficeAddress !== undefined
          ? { legalMainOfficeAddress: body.legalMainOfficeAddress?.trim() || null }
          : {}),
        ...(body.legalSafetyManagerName !== undefined
          ? { legalSafetyManagerName: body.legalSafetyManagerName?.trim() || null }
          : {}),
        ...(body.legalAlcoholDetectorModel !== undefined
          ? { legalAlcoholDetectorModel: body.legalAlcoholDetectorModel?.trim() || null }
          : {}),
        ...(body.legalAlcoholInspectionDone !== undefined
          ? { legalAlcoholInspectionDone: body.legalAlcoholInspectionDone }
          : {}),
        ...(body.legalAlcoholInspectionDate !== undefined ? { legalAlcoholInspectionDate } : {}),
        ...(body.legalMutualAidOrganizationName !== undefined
          ? { legalMutualAidOrganizationName: body.legalMutualAidOrganizationName?.trim() || null }
          : {}),
        ...(body.legalMutualAidContractFrom !== undefined ? { legalMutualAidContractFrom } : {}),
        ...(body.legalMutualAidContractTo !== undefined ? { legalMutualAidContractTo } : {}),
        ...(body.legalBodilyCoverage !== undefined
          ? { legalBodilyCoverage: body.legalBodilyCoverage?.trim() || null }
          : {}),
        ...(body.legalPropertyCoverage !== undefined
          ? { legalPropertyCoverage: body.legalPropertyCoverage?.trim() || null }
          : {}),
        ...(body.legalVehicleCoverageLimitManYen !== undefined
          ? { legalVehicleCoverageLimitManYen: body.legalVehicleCoverageLimitManYen?.trim() || null }
          : {}),
      },
    });

    await writeAuditEvent({
      tenantId: tid,
      actorUserId: u.sub,
      action: "tenant.settings.patch",
      entityType: "TenantSettings",
      entityId: tid,
      payload: JSON.parse(JSON.stringify({ patch: body })) as Prisma.InputJsonValue,
    });

    return updated;
  });
}
