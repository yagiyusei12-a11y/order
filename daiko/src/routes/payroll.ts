import type { FastifyInstance } from "fastify";
import type { CompensationType, Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { writeAuditEvent } from "../lib/audit.js";
import { userHasPermission, userHasWildcard } from "../lib/permissions.js";
import { prisma } from "../db.js";
import {
  commissionYenForSales,
  hourlyPayYen,
  netPayYen,
  poolYenFromGross,
} from "../lib/payroll-calc.js";
import { tenantFeatureEnabled } from "../lib/tenant-features.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerPayrollRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { periodYm?: string; limit?: string } }>(
    "/payroll-runs",
    { preHandler: [authenticate] },
    async (req) => {
      const tid = tenantIdFromReq(req);
      const periodYm = String(req.query?.periodYm || "").trim();
      const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query?.limit ?? 24))));
      const where: { tenantId: string; periodYm?: string } = { tenantId: tid };
      if (/^\d{4}-\d{2}$/.test(periodYm)) where.periodYm = periodYm;
      const runs = await prisma.payrollRun.findMany({
        where,
        orderBy: { periodYm: "desc" },
        take: limit,
        include: {
          lines: { include: { employee: true } },
        },
      });
      return { runs };
    },
  );

  app.get<{ Params: { id: string } }>("/payroll-runs/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, tenantId: tid },
      include: { lines: { include: { employee: true } } },
    });
    if (!run) return reply.code(404).send({ error: "not found" });
    return { run };
  });

  app.post<{ Body: { periodYm?: string; poolRateBps?: number } }>(
    "/payroll-runs/preview",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const periodYm = String(req.body?.periodYm || "").trim();
      if (!/^\d{4}-\d{2}$/.test(periodYm)) return reply.code(400).send({ error: "periodYm must be YYYY-MM" });
      const poolRateBps = Math.max(0, Math.min(10000, Math.floor(Number(req.body?.poolRateBps ?? 0))));

      const locked = await prisma.payrollRun.findFirst({
        where: { tenantId: tid, periodYm, status: "LOCKED" },
      });
      if (locked) return reply.code(403).send({ error: "period already locked" });

      const prefix = periodYm;
      const trips = await prisma.tripLeg.findMany({
        where: { dailyReport: { tenantId: tid, businessDate: { startsWith: prefix } } },
        include: { dailyReport: true },
      });

      const salesMain = new Map<string, number>();
      const salesPartner = new Map<string, number>();
      for (const t of trips) {
        const fare = t.fareYen;
        if (t.role === "MAIN_DRIVER") {
          const id = t.dailyReport.mainEmployeeId;
          salesMain.set(id, (salesMain.get(id) ?? 0) + fare);
        } else {
          const pid = t.dailyReport.partnerEmployeeId;
          if (pid) salesPartner.set(pid, (salesPartner.get(pid) ?? 0) + fare);
        }
      }

      const punches = await prisma.timePunch.findMany({
        where: { tenantId: tid, businessDate: { startsWith: prefix } },
      });
      const minutes = new Map<string, number>();
      for (const p of punches) {
        if (!p.clockOutAt) continue;
        const m = Math.max(0, Math.round((p.clockOutAt.getTime() - p.clockInAt.getTime()) / 60000));
        minutes.set(p.employeeId, (minutes.get(p.employeeId) ?? 0) + m);
      }

      const employeeIds = new Set<string>([...salesMain.keys(), ...salesPartner.keys(), ...minutes.keys()]);
      const lines: {
        employeeId: string;
        grossSalesYen: number;
        hourlyYen: number;
        commissionYen: number;
        poolYen: number;
        netPayYen: number;
        breakdownJson: Prisma.InputJsonValue;
      }[] = [];

      const monthStart = new Date(`${periodYm}-01T00:00:00.000Z`);
      const monthEnd = new Date(`${periodYm}-31T23:59:59.999Z`);

      for (const employeeId of employeeIds) {
        const comp = await prisma.employeeCompensationPeriod.findFirst({
          where: {
            employeeId,
            validFrom: { lte: monthEnd },
            OR: [{ validTo: null }, { validTo: { gte: monthStart } }],
          },
          orderBy: { validFrom: "desc" },
        });
        const type: CompensationType = comp?.compensationType ?? "HOURLY_ONLY";
        const row = {
          compensationType: type,
          baseHourlyYen: comp?.baseHourlyYen ?? 0,
          commissionMainRateBps: comp?.commissionMainRateBps ?? 0,
          commissionPartnerRateBps: comp?.commissionPartnerRateBps ?? 0,
        };
        const sm = salesMain.get(employeeId) ?? 0;
        const sp = salesPartner.get(employeeId) ?? 0;
        const gross = sm + sp;
        const mins = minutes.get(employeeId) ?? 0;
        const hourly = hourlyPayYen(mins, row.baseHourlyYen);
        const commission = commissionYenForSales(sm, sp, row);
        const grossBeforePool = hourly + commission;
        const pool = poolYenFromGross(grossBeforePool, poolRateBps);
        const net = netPayYen(hourly, commission, pool);
        lines.push({
          employeeId,
          grossSalesYen: gross,
          hourlyYen: hourly,
          commissionYen: commission,
          poolYen: pool,
          netPayYen: net,
          breakdownJson: {
            minutesWorked: mins,
            salesMainYen: sm,
            salesPartnerYen: sp,
            compensationType: type,
          },
        });
      }

      const run = await prisma.payrollRun.upsert({
        where: { tenantId_periodYm: { tenantId: tid, periodYm } },
        create: { tenantId: tid, periodYm, status: "DRAFT", poolRateBps },
        update: { poolRateBps, status: "DRAFT", lockedAt: null },
      });
      await prisma.payrollLine.deleteMany({ where: { runId: run.id } });
      for (const ln of lines) {
        await prisma.payrollLine.create({
          data: { runId: run.id, ...ln },
        });
      }
      const full = await prisma.payrollRun.findUnique({
        where: { id: run.id },
        include: { lines: { include: { employee: true } } },
      });
      return { run: full };
    },
  );

  app.post<{ Params: { id: string } }>("/payroll-runs/:id/lock", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!run) return reply.code(404).send({ error: "not found" });
    if (run.status === "LOCKED") return reply.code(400).send({ error: "already locked" });
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: "LOCKED", lockedAt: new Date() },
    });
    await writeAuditEvent({
      tenantId: tid,
      actorUserId: u.sub,
      action: "payroll.lock",
      entityType: "PayrollRun",
      entityId: run.id,
      payload: { periodYm: run.periodYm },
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/payroll-runs/:id/unlock", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!run) return reply.code(404).send({ error: "not found" });
    if (run.status !== "LOCKED") return reply.code(400).send({ error: "not locked" });

    const star = await userHasWildcard(u.sub, tid);
    const reopen = await tenantFeatureEnabled(tid, "payrollReopen");
    const canUnlock = await userHasPermission(u.sub, tid, "payroll.unlock");
    if (!star) {
      if (!reopen) return reply.code(403).send({ error: "payroll reopen disabled for this plan" });
      if (!canUnlock) return reply.code(403).send({ error: "missing permission payroll.unlock" });
    }

    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: "DRAFT", lockedAt: null },
    });
    await writeAuditEvent({
      tenantId: tid,
      actorUserId: u.sub,
      action: "payroll.unlock",
      entityType: "PayrollRun",
      entityId: run.id,
      payload: { periodYm: run.periodYm },
    });
    return updated;
  });
}
