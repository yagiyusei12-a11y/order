import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerTariffRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tariff-plans", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const rows = await prisma.tariffPlan.findMany({
      where: { tenantId: tid },
      include: { versions: { orderBy: { version: "desc" }, take: 3 } },
      orderBy: { name: "asc" },
    });
    return { plans: rows };
  });

  app.post<{ Body: { name?: string } }>("/tariff-plans", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const name = String(req.body?.name || "").trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const plan = await prisma.tariffPlan.create({ data: { tenantId: tid, name } });
    const ver = await prisma.tariffPlanVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        initialDistanceM: 2000,
        initialFareYen: 800,
        addUnitDistanceM: 200,
        addFareYen: 100,
        waitingFareYenPerMin: 0,
      },
    });
    return { plan, version: ver };
  });

  app.post<{
    Params: { planId: string };
    Body: {
      initialDistanceM?: number;
      initialFareYen?: number;
      addUnitDistanceM?: number;
      addFareYen?: number;
      waitingFareYenPerMin?: number;
    };
  }>("/tariff-plans/:planId/versions", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const plan = await prisma.tariffPlan.findFirst({ where: { id: req.params.planId, tenantId: tid } });
    if (!plan) return reply.code(404).send({ error: "not found" });
    const last = await prisma.tariffPlanVersion.findFirst({
      where: { planId: plan.id },
      orderBy: { version: "desc" },
    });
    const version = (last?.version ?? 0) + 1;
    const ver = await prisma.tariffPlanVersion.create({
      data: {
        planId: plan.id,
        version,
        initialDistanceM: Math.max(0, Math.floor(Number(req.body?.initialDistanceM ?? 2000))),
        initialFareYen: Math.max(0, Math.floor(Number(req.body?.initialFareYen ?? 800))),
        addUnitDistanceM: Math.max(1, Math.floor(Number(req.body?.addUnitDistanceM ?? 200))),
        addFareYen: Math.max(0, Math.floor(Number(req.body?.addFareYen ?? 100))),
        waitingFareYenPerMin: Math.max(0, Math.floor(Number(req.body?.waitingFareYenPerMin ?? 0))),
      },
    });
    return ver;
  });
}
