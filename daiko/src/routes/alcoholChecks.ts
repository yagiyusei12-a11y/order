import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { businessDateYmdForOccurredAt } from "../lib/business-date.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerAlcoholRoutes(app: FastifyInstance): Promise<void> {
  app.get("/alcohol-checks", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const { businessDate } = req.query as { businessDate?: string };
    const rows = await prisma.alcoholCheck.findMany({
      where: { tenantId: tid, ...(businessDate ? { businessDate } : {}) },
      orderBy: { checkedAt: "desc" },
      take: 200,
      include: { employee: true },
    });
    return { checks: rows };
  });

  app.post<{
    Body: {
      employeeId?: string;
      phase?: string;
      checkedAt?: string;
      methodNote?: string;
      detectorUsed?: boolean;
      resultPositive?: boolean;
      supervisorNote?: string;
    };
  }>("/alcohol-checks", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const tenant = await prisma.tenant.findUnique({ where: { id: tid }, include: { settings: true } });
    if (!tenant?.settings) return reply.code(500).send({ error: "tenant settings missing" });
    const employeeId = String(req.body?.employeeId || "");
    const phase = String(req.body?.phase || "").trim();
    const checkedAt = req.body?.checkedAt ? new Date(req.body.checkedAt) : new Date();
    if (!employeeId || !phase) return reply.code(400).send({ error: "employeeId, phase required" });
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: tid } });
    if (!emp) return reply.code(404).send({ error: "employee not found" });
    const businessDate = businessDateYmdForOccurredAt(checkedAt, tenant.timezone, tenant.settings.businessDayRollHour);
    return prisma.alcoholCheck.create({
      data: {
        tenantId: tid,
        employeeId,
        businessDate,
        phase,
        checkedAt,
        methodNote: req.body?.methodNote ? String(req.body.methodNote).slice(0, 500) : null,
        detectorUsed: Boolean(req.body?.detectorUsed),
        resultPositive: Boolean(req.body?.resultPositive),
        supervisorNote: req.body?.supervisorNote ? String(req.body.supervisorNote).slice(0, 1000) : null,
      },
    });
  });
}
