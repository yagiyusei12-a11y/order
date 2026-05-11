import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const complaintSchema = z.object({
  receivedAt: z.string().min(1),
  receivedBy: z.string().max(200).optional(),
  occurredOn: z.string().optional(),
  placeOrSection: z.string().max(1000).optional(),
  driverEmployeeId: z.string().optional().nullable(),
  complainantName: z.string().max(200).optional(),
  complainantAddress: z.string().max(2000).optional(),
  complainantContact: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  categoryOther: z.string().max(200).optional(),
  detail: z.string().max(8000).optional(),
  causeAnalysis: z.string().max(8000).optional(),
  rebuttal: z.string().max(8000).optional(),
  correctiveAction: z.string().max(8000).optional(),
  handlerName: z.string().max(200).optional(),
  completedOn: z.string().optional(),
  representativeChecked: z.boolean().optional(),
});

const guidanceSchema = z.object({
  startedAt: z.string().min(1),
  endedAt: z.string().optional(),
  location: z.string().max(1000).optional(),
  instructorName: z.string().max(200).optional(),
  topicFeeCollection: z.boolean().optional(),
  topicTerms: z.boolean().optional(),
  topicConditionExplain: z.boolean().optional(),
  topicMarking: z.boolean().optional(),
  topicRoadTransportLaw: z.boolean().optional(),
  topicOther: z.string().max(200).optional(),
  topicOtherDetail: z.string().max(8000).optional(),
  remarks: z.string().max(8000).optional(),
  representativeChecked: z.boolean().optional(),
  attendees: z
    .array(
      z.object({
        employeeId: z.string().optional().nullable(),
        attendeeName: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .optional(),
});

const changeNoticeSchema = z.object({
  changeType: z.string().max(200).optional(),
  submittedOn: z.string().optional(),
  changedOn: z.string().optional(),
  effectiveOn: z.string().optional(),
  oldValue: z.string().max(4000).optional(),
  newValue: z.string().max(4000).optional(),
  reason: z.string().max(8000).optional(),
  notes: z.string().max(8000).optional(),
});

function parseDateOptional(v: string | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (!v.trim()) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

export async function registerLegalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/legal/complaints", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const items = await prisma.complaintLedger.findMany({
      where: { tenantId: tid },
      include: { driverEmployee: true },
      orderBy: { receivedAt: "desc" },
      take: 200,
    });
    return { items };
  });

  app.post<{ Body: z.infer<typeof complaintSchema> }>("/legal/complaints", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = complaintSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const receivedAt = new Date(b.receivedAt);
    if (!Number.isFinite(receivedAt.getTime())) return reply.code(400).send({ error: "invalid receivedAt" });
    const occurredOn = parseDateOptional(b.occurredOn);
    const completedOn = parseDateOptional(b.completedOn);
    if ((b.occurredOn !== undefined && occurredOn === undefined) || (b.completedOn !== undefined && completedOn === undefined)) {
      return reply.code(400).send({ error: "invalid occurredOn/completedOn" });
    }
    const row = await prisma.complaintLedger.create({
      data: {
        tenantId: tid,
        receivedAt,
        receivedBy: b.receivedBy?.trim() || null,
        occurredOn: occurredOn ?? null,
        placeOrSection: b.placeOrSection?.trim() || null,
        driverEmployeeId: b.driverEmployeeId?.trim() || null,
        complainantName: b.complainantName?.trim() || null,
        complainantAddress: b.complainantAddress?.trim() || null,
        complainantContact: b.complainantContact?.trim() || null,
        category: b.category?.trim() || null,
        categoryOther: b.categoryOther?.trim() || null,
        detail: b.detail?.trim() || null,
        causeAnalysis: b.causeAnalysis?.trim() || null,
        rebuttal: b.rebuttal?.trim() || null,
        correctiveAction: b.correctiveAction?.trim() || null,
        handlerName: b.handlerName?.trim() || null,
        completedOn: completedOn ?? null,
        representativeChecked: Boolean(b.representativeChecked),
      },
    });
    return row;
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof complaintSchema> }>("/legal/complaints/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.complaintLedger.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    const parsed = complaintSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const data: Record<string, unknown> = {};
    if (b.receivedAt !== undefined) {
      const d = new Date(b.receivedAt);
      if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid receivedAt" });
      data.receivedAt = d;
    }
    const occurredOn = parseDateOptional(b.occurredOn);
    const completedOn = parseDateOptional(b.completedOn);
    if (b.occurredOn !== undefined && occurredOn === undefined) return reply.code(400).send({ error: "invalid occurredOn" });
    if (b.completedOn !== undefined && completedOn === undefined) return reply.code(400).send({ error: "invalid completedOn" });
    if (b.receivedBy !== undefined) data.receivedBy = b.receivedBy?.trim() || null;
    if (b.occurredOn !== undefined) data.occurredOn = occurredOn ?? null;
    if (b.placeOrSection !== undefined) data.placeOrSection = b.placeOrSection?.trim() || null;
    if (b.driverEmployeeId !== undefined) data.driverEmployeeId = b.driverEmployeeId?.trim() || null;
    if (b.complainantName !== undefined) data.complainantName = b.complainantName?.trim() || null;
    if (b.complainantAddress !== undefined) data.complainantAddress = b.complainantAddress?.trim() || null;
    if (b.complainantContact !== undefined) data.complainantContact = b.complainantContact?.trim() || null;
    if (b.category !== undefined) data.category = b.category?.trim() || null;
    if (b.categoryOther !== undefined) data.categoryOther = b.categoryOther?.trim() || null;
    if (b.detail !== undefined) data.detail = b.detail?.trim() || null;
    if (b.causeAnalysis !== undefined) data.causeAnalysis = b.causeAnalysis?.trim() || null;
    if (b.rebuttal !== undefined) data.rebuttal = b.rebuttal?.trim() || null;
    if (b.correctiveAction !== undefined) data.correctiveAction = b.correctiveAction?.trim() || null;
    if (b.handlerName !== undefined) data.handlerName = b.handlerName?.trim() || null;
    if (b.completedOn !== undefined) data.completedOn = completedOn ?? null;
    if (b.representativeChecked !== undefined) data.representativeChecked = Boolean(b.representativeChecked);
    return prisma.complaintLedger.update({ where: { id: cur.id }, data });
  });

  app.delete<{ Params: { id: string } }>("/legal/complaints/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.complaintLedger.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    await prisma.complaintLedger.delete({ where: { id: cur.id } });
    return { ok: true };
  });

  app.get("/legal/guidance", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const items = await prisma.guidanceSession.findMany({
      where: { tenantId: tid },
      include: { attendees: { include: { employee: true } } },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
    return { items };
  });

  app.post<{ Body: z.infer<typeof guidanceSchema> }>("/legal/guidance", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = guidanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const startedAt = new Date(b.startedAt);
    if (!Number.isFinite(startedAt.getTime())) return reply.code(400).send({ error: "invalid startedAt" });
    const endedAt = parseDateOptional(b.endedAt);
    if (b.endedAt !== undefined && endedAt === undefined) return reply.code(400).send({ error: "invalid endedAt" });
    const row = await prisma.guidanceSession.create({
      data: {
        tenantId: tid,
        startedAt,
        endedAt: endedAt ?? null,
        location: b.location?.trim() || null,
        instructorName: b.instructorName?.trim() || null,
        topicFeeCollection: Boolean(b.topicFeeCollection),
        topicTerms: Boolean(b.topicTerms),
        topicConditionExplain: Boolean(b.topicConditionExplain),
        topicMarking: Boolean(b.topicMarking),
        topicRoadTransportLaw: Boolean(b.topicRoadTransportLaw),
        topicOther: b.topicOther?.trim() || null,
        topicOtherDetail: b.topicOtherDetail?.trim() || null,
        remarks: b.remarks?.trim() || null,
        representativeChecked: Boolean(b.representativeChecked),
        attendees: b.attendees?.length
          ? {
              create: b.attendees.map((a) => ({
                employeeId: a.employeeId?.trim() || null,
                attendeeName: a.attendeeName?.trim() || null,
              })),
            }
          : undefined,
      },
      include: { attendees: { include: { employee: true } } },
    });
    return row;
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof guidanceSchema> }>("/legal/guidance/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.guidanceSession.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    const parsed = guidanceSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const data: Record<string, unknown> = {};
    if (b.startedAt !== undefined) {
      const d = new Date(b.startedAt);
      if (!Number.isFinite(d.getTime())) return reply.code(400).send({ error: "invalid startedAt" });
      data.startedAt = d;
    }
    const endedAt = parseDateOptional(b.endedAt);
    if (b.endedAt !== undefined && endedAt === undefined) return reply.code(400).send({ error: "invalid endedAt" });
    if (b.endedAt !== undefined) data.endedAt = endedAt ?? null;
    if (b.location !== undefined) data.location = b.location?.trim() || null;
    if (b.instructorName !== undefined) data.instructorName = b.instructorName?.trim() || null;
    if (b.topicFeeCollection !== undefined) data.topicFeeCollection = Boolean(b.topicFeeCollection);
    if (b.topicTerms !== undefined) data.topicTerms = Boolean(b.topicTerms);
    if (b.topicConditionExplain !== undefined) data.topicConditionExplain = Boolean(b.topicConditionExplain);
    if (b.topicMarking !== undefined) data.topicMarking = Boolean(b.topicMarking);
    if (b.topicRoadTransportLaw !== undefined) data.topicRoadTransportLaw = Boolean(b.topicRoadTransportLaw);
    if (b.topicOther !== undefined) data.topicOther = b.topicOther?.trim() || null;
    if (b.topicOtherDetail !== undefined) data.topicOtherDetail = b.topicOtherDetail?.trim() || null;
    if (b.remarks !== undefined) data.remarks = b.remarks?.trim() || null;
    if (b.representativeChecked !== undefined) data.representativeChecked = Boolean(b.representativeChecked);
    await prisma.guidanceSession.update({ where: { id: cur.id }, data });
    if (b.attendees !== undefined) {
      await prisma.guidanceAttendee.deleteMany({ where: { guidanceSessionId: cur.id } });
      if (b.attendees.length) {
        await prisma.guidanceAttendee.createMany({
          data: b.attendees.map((a) => ({
            guidanceSessionId: cur.id,
            employeeId: a.employeeId?.trim() || null,
            attendeeName: a.attendeeName?.trim() || null,
          })),
        });
      }
    }
    return prisma.guidanceSession.findUnique({
      where: { id: cur.id },
      include: { attendees: { include: { employee: true } } },
    });
  });

  app.delete<{ Params: { id: string } }>("/legal/guidance/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.guidanceSession.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    await prisma.guidanceSession.delete({ where: { id: cur.id } });
    return { ok: true };
  });

  app.get("/legal/change-notices", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const items = await prisma.legalChangeNotice.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { items };
  });

  app.post<{ Body: z.infer<typeof changeNoticeSchema> }>("/legal/change-notices", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const parsed = changeNoticeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const submittedOn = parseDateOptional(b.submittedOn);
    const changedOn = parseDateOptional(b.changedOn);
    const effectiveOn = parseDateOptional(b.effectiveOn);
    if (
      (b.submittedOn !== undefined && submittedOn === undefined) ||
      (b.changedOn !== undefined && changedOn === undefined) ||
      (b.effectiveOn !== undefined && effectiveOn === undefined)
    ) {
      return reply.code(400).send({ error: "invalid date field" });
    }
    return prisma.legalChangeNotice.create({
      data: {
        tenantId: tid,
        changeType: b.changeType?.trim() || null,
        submittedOn: submittedOn ?? null,
        changedOn: changedOn ?? null,
        effectiveOn: effectiveOn ?? null,
        oldValue: b.oldValue?.trim() || null,
        newValue: b.newValue?.trim() || null,
        reason: b.reason?.trim() || null,
        notes: b.notes?.trim() || null,
      },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof changeNoticeSchema> }>("/legal/change-notices/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.legalChangeNotice.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    const parsed = changeNoticeSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const submittedOn = parseDateOptional(b.submittedOn);
    const changedOn = parseDateOptional(b.changedOn);
    const effectiveOn = parseDateOptional(b.effectiveOn);
    if (
      (b.submittedOn !== undefined && submittedOn === undefined) ||
      (b.changedOn !== undefined && changedOn === undefined) ||
      (b.effectiveOn !== undefined && effectiveOn === undefined)
    ) {
      return reply.code(400).send({ error: "invalid date field" });
    }
    const data: Record<string, unknown> = {};
    if (b.changeType !== undefined) data.changeType = b.changeType?.trim() || null;
    if (b.submittedOn !== undefined) data.submittedOn = submittedOn ?? null;
    if (b.changedOn !== undefined) data.changedOn = changedOn ?? null;
    if (b.effectiveOn !== undefined) data.effectiveOn = effectiveOn ?? null;
    if (b.oldValue !== undefined) data.oldValue = b.oldValue?.trim() || null;
    if (b.newValue !== undefined) data.newValue = b.newValue?.trim() || null;
    if (b.reason !== undefined) data.reason = b.reason?.trim() || null;
    if (b.notes !== undefined) data.notes = b.notes?.trim() || null;
    return prisma.legalChangeNotice.update({ where: { id: cur.id }, data });
  });

  app.delete<{ Params: { id: string } }>("/legal/change-notices/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const cur = await prisma.legalChangeNotice.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });
    await prisma.legalChangeNotice.delete({ where: { id: cur.id } });
    return { ok: true };
  });
}
