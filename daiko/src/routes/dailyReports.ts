import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { businessDateYmdForOccurredAt } from "../lib/business-date.js";
import { fareYenForDistance } from "../lib/pricing.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerDailyReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/daily-reports", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const { from, to } = req.query as { from?: string; to?: string };
    const where: { tenantId: string; businessDate?: { gte: string; lte: string } } = { tenantId: tid };
    if (from && to) where.businessDate = { gte: from, lte: to };
    const rows = await prisma.dailyReport.findMany({
      where,
      orderBy: { businessDate: "desc" },
      include: { vehicle: true, mainEmployee: true, partnerEmployee: true, trips: true },
      take: 100,
    });
    return { dailyReports: rows };
  });

  app.post<{
    Body: {
      vehicleId?: string;
      mainEmployeeId?: string;
      partnerEmployeeId?: string | null;
      meterStart?: number;
      meterEnd?: number;
      occurredAt?: string;
    };
  }>("/daily-reports", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tid },
      include: { settings: true },
    });
    if (!tenant?.settings) return reply.code(500).send({ error: "tenant settings missing" });
    const vehicleId = String(req.body?.vehicleId || "");
    const mainEmployeeId = String(req.body?.mainEmployeeId || "");
    const meterStart = Math.floor(Number(req.body?.meterStart ?? NaN));
    const meterEnd = Math.floor(Number(req.body?.meterEnd ?? NaN));
    if (!vehicleId || !mainEmployeeId || !Number.isFinite(meterStart) || !Number.isFinite(meterEnd)) {
      return reply.code(400).send({ error: "vehicleId, mainEmployeeId, meterStart, meterEnd required" });
    }
    const at = req.body?.occurredAt ? new Date(req.body.occurredAt) : new Date();
    if (!Number.isFinite(at.getTime())) return reply.code(400).send({ error: "invalid occurredAt" });
    const businessDate = businessDateYmdForOccurredAt(at, tenant.timezone, tenant.settings.businessDayRollHour);
    const row = await prisma.dailyReport.create({
      data: {
        tenantId: tid,
        businessDate,
        vehicleId,
        mainEmployeeId,
        partnerEmployeeId: req.body?.partnerEmployeeId ? String(req.body.partnerEmployeeId) : null,
        meterStart,
        meterEnd,
      },
    });
    return row;
  });

  app.delete<{ Params: { id: string } }>("/daily-reports/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const row = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!row) return reply.code(404).send({ error: "not found" });
    const ym = row.businessDate.slice(0, 7);
    const run = await prisma.payrollRun.findFirst({
      where: { tenantId: tid, status: "LOCKED", periodYm: ym },
    });
    if (run) return reply.code(403).send({ error: "payroll locked for this month; cannot delete" });
    await prisma.dailyReport.delete({ where: { id: row.id } });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: {
      clientName?: string;
      charterVehicleNo?: string;
      origin?: string;
      destination?: string;
      viaNote?: string;
      departedAt?: string;
      arrivedAt?: string;
      distanceM?: number;
      tariffVersionId?: string | null;
      role?: string;
    };
  }>("/daily-reports/:id/trips", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const rep = await prisma.dailyReport.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!rep) return reply.code(404).send({ error: "not found" });
    const clientName = String(req.body?.clientName || "").trim();
    const origin = String(req.body?.origin || "").trim();
    const destination = String(req.body?.destination || "").trim();
    const departedAt = req.body?.departedAt ? new Date(req.body.departedAt) : null;
    const arrivedAt = req.body?.arrivedAt ? new Date(req.body.arrivedAt) : null;
    const distanceM = Math.floor(Number(req.body?.distanceM ?? NaN));
    if (!clientName || !origin || !destination || !departedAt || !arrivedAt || !Number.isFinite(distanceM)) {
      return reply.code(400).send({ error: "clientName, origin, destination, departedAt, arrivedAt, distanceM required" });
    }
    let fareYen = 0;
    let tariffVersionId: string | null = req.body?.tariffVersionId ? String(req.body.tariffVersionId) : null;
    if (tariffVersionId) {
      const ver = await prisma.tariffPlanVersion.findFirst({
        where: { id: tariffVersionId, plan: { tenantId: tid } },
      });
      if (!ver) return reply.code(400).send({ error: "invalid tariffVersionId" });
      fareYen = fareYenForDistance(ver, distanceM);
    }
    const role = req.body?.role === "PARTNER_DRIVER" ? "PARTNER_DRIVER" : "MAIN_DRIVER";
    const trip = await prisma.tripLeg.create({
      data: {
        dailyReportId: rep.id,
        clientName,
        charterVehicleNo: req.body?.charterVehicleNo ? String(req.body.charterVehicleNo).trim() || null : null,
        origin,
        destination,
        viaNote: req.body?.viaNote ? String(req.body.viaNote).trim() || null : null,
        departedAt,
        arrivedAt,
        distanceM,
        tariffVersionId,
        fareYen,
        role,
      },
    });
    return trip;
  });
}
