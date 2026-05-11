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
});

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

    const updated = await prisma.tenantSettings.update({
      where: { tenantId: tid },
      data: {
        ...(body.businessDayRollHour !== undefined ? { businessDayRollHour: body.businessDayRollHour } : {}),
        ...(body.featureFlags !== undefined
          ? { featureFlags: body.featureFlags as Prisma.InputJsonValue }
          : {}),
        ...(body.customJson !== undefined ? { customJson: body.customJson as Prisma.InputJsonValue } : {}),
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
