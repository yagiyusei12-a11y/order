import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerEmployeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/employees", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const { status } = req.query as { status?: string };
    const where = {
      tenantId: tid,
      ...(status === "retired" ? { status: "RETIRED" as const } : status === "all" ? {} : { status: "ACTIVE" as const }),
    };
    const rows = await prisma.employee.findMany({
      where,
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    });
    return { employees: rows };
  });

  app.post<{
    Body: {
      familyName?: string;
      givenName?: string;
      furigana?: string;
      address?: string;
    };
  }>("/employees", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const familyName = String(req.body?.familyName || "").trim();
    const givenName = String(req.body?.givenName || "").trim();
    if (!familyName || !givenName) return reply.code(400).send({ error: "familyName, givenName required" });
    const row = await prisma.employee.create({
      data: {
        tenantId: tid,
        familyName,
        givenName,
        furigana: req.body?.furigana ? String(req.body.furigana).trim() || null : null,
        address: req.body?.address ? String(req.body.address).trim() || null : null,
        status: "ACTIVE",
      },
    });
    return row;
  });

  app.patch<{
    Params: { id: string };
    Body: { status?: string; retiredAt?: string | null };
  }>("/employees/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const id = req.params.id;
    const cur = await prisma.employee.findFirst({ where: { id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    const data: { status?: "ACTIVE" | "RETIRED"; retiredAt?: Date | null } = {};
    if (req.body?.status === "retired" || req.body?.status === "RETIRED") {
      data.status = "RETIRED";
      data.retiredAt = new Date();
    } else if (req.body?.status === "active" || req.body?.status === "ACTIVE") {
      data.status = "ACTIVE";
      data.retiredAt = null;
    }
    const row = await prisma.employee.update({ where: { id }, data });
    return row;
  });

  app.post<{
    Params: { id: string };
    Body: {
      validFrom?: string;
      compensationType?: string;
      baseHourlyYen?: number;
      commissionMainRateBps?: number;
      commissionPartnerRateBps?: number;
    };
  }>("/employees/:id/compensation", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!emp) return reply.code(404).send({ error: "not found" });
    const ct = req.body?.compensationType;
    if (ct !== "HOURLY_ONLY" && ct !== "COMMISSION_ONLY" && ct !== "HOURLY_AND_COMMISSION") {
      return reply.code(400).send({ error: "invalid compensationType" });
    }
    const validFrom = req.body?.validFrom ? new Date(req.body.validFrom) : new Date();
    if (!Number.isFinite(validFrom.getTime())) return reply.code(400).send({ error: "invalid validFrom" });
    const row = await prisma.employeeCompensationPeriod.create({
      data: {
        employeeId: emp.id,
        validFrom,
        compensationType: ct,
        baseHourlyYen: Math.max(0, Math.floor(Number(req.body?.baseHourlyYen ?? 0))),
        commissionMainRateBps: Math.max(0, Math.floor(Number(req.body?.commissionMainRateBps ?? 0))),
        commissionPartnerRateBps: Math.max(0, Math.floor(Number(req.body?.commissionPartnerRateBps ?? 0))),
      },
    });
    return row;
  });
}
