import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

function parseDateOrNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

const vehiclePostSchema = z.object({
  label: z.string().optional(),
  plate: z.string().nullable().optional(),
  active: z.boolean().optional(),
  legalCoverageStartOn: z.string().max(50).nullable().optional(),
});

const vehiclePatchSchema = z.object({
  label: z.string().optional(),
  plate: z.string().nullable().optional(),
  active: z.boolean().optional(),
  legalCoverageStartOn: z.string().max(50).nullable().optional(),
});

export async function registerVehicleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/vehicles", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const activeOnly = (req.query as { active?: string }).active !== "0";
    const rows = await prisma.vehicle.findMany({
      where: { tenantId: tid, ...(activeOnly ? { active: true } : {}) },
      orderBy: { label: "asc" },
    });
    return { vehicles: rows };
  });

  app.post<{ Body: z.infer<typeof vehiclePostSchema> }>("/vehicles", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = vehiclePostSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    const b = parsed.data;
    const label = String(b.label || "").trim();
    if (!label) return reply.code(400).send({ error: "label required" });
    const legalCoverageStartOn = parseDateOrNull(b.legalCoverageStartOn);
    if (b.legalCoverageStartOn !== undefined && legalCoverageStartOn === undefined) {
      return reply.code(400).send({ error: "invalid legalCoverageStartOn" });
    }
    return prisma.vehicle.create({
      data: {
        tenantId: tid,
        label,
        plate: b.plate !== undefined ? (b.plate ? String(b.plate).trim() : null) : null,
        active: b.active === false ? false : true,
        ...(b.legalCoverageStartOn !== undefined ? { legalCoverageStartOn: legalCoverageStartOn ?? null } : {}),
      },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof vehiclePatchSchema> }>(
    "/vehicles/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const v = await prisma.vehicle.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!v) return reply.code(404).send({ error: "not found" });
      const parsed = vehiclePatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
      const b = parsed.data;
      const data: {
        label?: string;
        plate?: string | null;
        active?: boolean;
        legalCoverageStartOn?: Date | null;
      } = {};
      if (typeof b.label === "string") data.label = b.label.trim();
      if (typeof b.plate === "string") data.plate = b.plate.trim() || null;
      if (typeof b.active === "boolean") data.active = b.active;
      if (b.legalCoverageStartOn !== undefined) {
        const d = parseDateOrNull(b.legalCoverageStartOn);
        if (d === undefined) {
          return reply.code(400).send({ error: "invalid legalCoverageStartOn" });
        }
        data.legalCoverageStartOn = d;
      }
      return prisma.vehicle.update({ where: { id: v.id }, data });
    },
  );
}
