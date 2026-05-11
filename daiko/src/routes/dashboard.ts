import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantFeatureEnabled } from "../lib/tenant-features.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { ym?: string } }>("/dashboard", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const ok = await tenantFeatureEnabled(tid, "dashboard");
    if (!ok) return reply.code(403).send({ error: "feature disabled: dashboard" });

    const ym = String(req.query?.ym || "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return reply.code(400).send({ error: "ym must be YYYY-MM" });
    const prefix = ym;

    const [salesAgg, tripCount, reportCount, punches] = await Promise.all([
      prisma.tripLeg.aggregate({
        _sum: { fareYen: true },
        where: { dailyReport: { tenantId: tid, businessDate: { startsWith: prefix } } },
      }),
      prisma.tripLeg.count({
        where: { dailyReport: { tenantId: tid, businessDate: { startsWith: prefix } } },
      }),
      prisma.dailyReport.count({
        where: { tenantId: tid, businessDate: { startsWith: prefix } },
      }),
      prisma.timePunch.findMany({
        where: { tenantId: tid, businessDate: { startsWith: prefix } },
        select: { employeeId: true, clockInAt: true, clockOutAt: true },
      }),
    ]);

    let attendanceMinutesTotal = 0;
    const byEmployee: Record<string, number> = {};
    for (const p of punches) {
      if (!p.clockOutAt) continue;
      const m = Math.max(0, Math.round((p.clockOutAt.getTime() - p.clockInAt.getTime()) / 60000));
      attendanceMinutesTotal += m;
      byEmployee[p.employeeId] = (byEmployee[p.employeeId] ?? 0) + m;
    }

    return {
      ym,
      salesYen: salesAgg._sum.fareYen ?? 0,
      tripLegCount: tripCount,
      dailyReportCount: reportCount,
      attendance: {
        punchCount: punches.length,
        completedPunchCount: punches.filter((p) => p.clockOutAt).length,
        minutesTotal: attendanceMinutesTotal,
        minutesByEmployeeId: byEmployee,
      },
    };
  });
}
