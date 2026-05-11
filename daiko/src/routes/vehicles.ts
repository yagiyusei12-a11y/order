import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

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

  app.post<{ Body: { label?: string; plate?: string; active?: boolean } }>(
    "/vehicles",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const label = String(req.body?.label || "").trim();
      if (!label) return reply.code(400).send({ error: "label required" });
      return prisma.vehicle.create({
        data: {
          tenantId: tid,
          label,
          plate: req.body?.plate ? String(req.body.plate).trim() || null : null,
          active: req.body?.active === false ? false : true,
        },
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: { label?: string; plate?: string; active?: boolean } }>(
    "/vehicles/:id",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const v = await prisma.vehicle.findFirst({ where: { id: req.params.id, tenantId: tid } });
      if (!v) return reply.code(404).send({ error: "not found" });
      const data: { label?: string; plate?: string | null; active?: boolean } = {};
      if (typeof req.body?.label === "string") data.label = req.body.label.trim();
      if (typeof req.body?.plate === "string") data.plate = req.body.plate.trim() || null;
      if (typeof req.body?.active === "boolean") data.active = req.body.active;
      return prisma.vehicle.update({ where: { id: v.id }, data });
    },
  );
}
