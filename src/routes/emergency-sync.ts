import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { assertManagerRole } from "../lib/staff-role.js";
import { newGuestToken } from "../lib/token.js";

const EXPORT_KIND = "morder-emergency-export";
const EXPORT_VERSION = 1;

type ExportLine = {
  menuItemId: string | null;
  nameSnapshot: string;
  unitPrice: number;
  qty: number;
  note: string | null;
  lineExtra: unknown;
  eatMode: string;
  taxRatePercent: number;
  status: string;
  readyAt: string | null;
  servedAt: string | null;
};

type ExportPayment = {
  methodCode: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

type ExportSession = {
  sourceSessionId: string;
  tablePublicCode: string;
  tableName: string;
  guestCount: number;
  childCount: number;
  openedAt: string;
  closedAt: string | null;
  status: string;
  orders: Array<{ createdAt: string; lines: ExportLine[] }>;
  bill: {
    totalAmount: number;
    status: string;
    settledAt: string | null;
    discountJson: unknown;
    payments: ExportPayment[];
  } | null;
};

type ExportPayload = {
  version: number;
  kind: string;
  exportId: string;
  exportedAt: string;
  storeId: string;
  sessions: ExportSession[];
};

function staffSub(req: { user?: unknown }): string | null {
  const u = req.user as { sub?: string } | undefined;
  return u?.sub ?? null;
}

function isExportPayload(raw: unknown): raw is ExportPayload {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return o.kind === EXPORT_KIND && o.version === EXPORT_VERSION && Array.isArray(o.sessions);
}

function emergencyLabel(exportId: string, sourceSessionId: string): string {
  return `emergency:${exportId}:${sourceSessionId}`;
}

export async function registerEmergencySync(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/emergency-export", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const storeId = req.params.storeId;
    const sessions = await prisma.diningSession.findMany({
      where: {
        storeId,
        bill: { is: { status: "settled" } },
      },
      include: {
        table: true,
        bill: { include: { payments: { where: { voidedAt: null }, orderBy: { createdAt: "asc" } } } },
        orders: { include: { lines: { orderBy: { id: "asc" } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { openedAt: "asc" },
    });

    const payload: ExportPayload = {
      version: EXPORT_VERSION,
      kind: EXPORT_KIND,
      exportId: randomUUID(),
      exportedAt: new Date().toISOString(),
      storeId,
      sessions: sessions.map((s) => ({
        sourceSessionId: s.id,
        tablePublicCode: s.table.publicCode,
        tableName: s.table.name,
        guestCount: s.guestCount,
        childCount: s.childCount,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        status: s.status,
        orders: s.orders.map((o) => ({
          createdAt: o.createdAt.toISOString(),
          lines: o.lines.map((ln) => ({
            menuItemId: ln.menuItemId,
            nameSnapshot: ln.nameSnapshot,
            unitPrice: ln.unitPrice,
            qty: ln.qty,
            note: ln.note,
            lineExtra: ln.lineExtra,
            eatMode: ln.eatMode,
            taxRatePercent: ln.taxRatePercent,
            status: ln.status,
            readyAt: ln.readyAt ? ln.readyAt.toISOString() : null,
            servedAt: ln.servedAt ? ln.servedAt.toISOString() : null,
          })),
        })),
        bill: s.bill
          ? {
              totalAmount: s.bill.totalAmount,
              status: s.bill.status,
              settledAt: s.bill.settledAt ? s.bill.settledAt.toISOString() : null,
              discountJson: s.bill.discountJson,
              payments: s.bill.payments.map((p) => ({
                methodCode: p.methodCode,
                amount: p.amount,
                note: p.note,
                createdAt: p.createdAt.toISOString(),
              })),
            }
          : null,
      })),
    };

    await appendStaffAuditFromRequest(req, storeId, staffSub(req), "emergency_export", {
      exportId: payload.exportId,
      sessionCount: payload.sessions.length,
    });
    return payload;
  });

  app.post<{ Params: { storeId: string }; Body: unknown }>(
    "/stores/:storeId/emergency-import",
    async (req, reply) => {
      if (!assertManagerRole(reply, req.user)) return;
      const storeId = req.params.storeId;
      const body = req.body;
      if (!isExportPayload(body)) {
        return reply.code(400).send({ error: "invalid emergency export JSON" });
      }
      if (body.storeId && body.storeId !== storeId) {
        return reply.code(400).send({ error: `export storeId is ${body.storeId}, expected ${storeId}` });
      }

      const tables = await prisma.table.findMany({ where: { storeId } });
      const byCode = new Map(tables.map((t) => [t.publicCode, t]));
      const byName = new Map(tables.map((t) => [t.name, t]));
      const menuItems = await prisma.menuItem.findMany({
        where: { category: { storeId } },
        select: { id: true, name: true },
      });
      const menuById = new Set(menuItems.map((m) => m.id));
      const menuByName = new Map<string, string>();
      for (const m of menuItems) {
        if (!menuByName.has(m.name)) menuByName.set(m.name, m.id);
      }

      const methodCodes = new Set<string>();
      for (const s of body.sessions) {
        for (const p of s.bill?.payments || []) methodCodes.add(p.methodCode);
      }
      for (const code of methodCodes) {
        if (!code) continue;
        await prisma.paymentMethodDefinition.upsert({
          where: { code },
          create: { code, labelJa: code, sortOrder: 80 },
          update: {},
        });
        const def = await prisma.paymentMethodDefinition.findUnique({ where: { code } });
        if (!def) continue;
        await prisma.storePaymentMethod.upsert({
          where: { storeId_definitionId: { storeId, definitionId: def.id } },
          create: { storeId, definitionId: def.id, enabled: true, sortOrder: 80 },
          update: {},
        });
      }

      let imported = 0;
      let skippedDup = 0;
      let skippedNoTable = 0;
      const fallbackTable =
        byCode.get(`takeout-${storeId}`) || tables.find((t) => t.active) || tables[0] || null;

      for (const s of body.sessions) {
        if (!s.bill) continue;
        const billIn = s.bill;
        const label = emergencyLabel(body.exportId, s.sourceSessionId);
        const dup = await prisma.bill.findFirst({ where: { storeId, label } });
        if (dup) {
          skippedDup += 1;
          continue;
        }
        const table =
          byCode.get(s.tablePublicCode) || byName.get(s.tableName) || fallbackTable;
        if (!table) {
          skippedNoTable += 1;
          continue;
        }

        let guestToken = newGuestToken();
        for (let i = 0; i < 6; i++) {
          const clash = await prisma.diningSession.findUnique({ where: { guestToken } });
          if (!clash) break;
          guestToken = newGuestToken();
        }

        const openedAt = s.openedAt ? new Date(s.openedAt) : new Date();
        const closedAt = s.closedAt ? new Date(s.closedAt) : billIn.settledAt ? new Date(billIn.settledAt) : new Date();

        await prisma.$transaction(async (tx) => {
          const session = await tx.diningSession.create({
            data: {
              storeId,
              tableId: table.id,
              guestToken,
              guestCount: Math.max(1, Number(s.guestCount) || 1),
              childCount: Math.max(0, Number(s.childCount) || 0),
              status: "closed",
              openedAt,
              closedAt,
            },
          });
          for (const order of s.orders || []) {
            const created = await tx.salesOrder.create({
              data: {
                sessionId: session.id,
                sourceTableId: table.id,
                status: "submitted",
                createdAt: order.createdAt ? new Date(order.createdAt) : openedAt,
              },
            });
            for (const ln of order.lines || []) {
              const mid =
                ln.menuItemId && menuById.has(ln.menuItemId)
                  ? ln.menuItemId
                  : menuByName.get(ln.nameSnapshot) || null;
              await tx.orderLine.create({
                data: {
                  orderId: created.id,
                  menuItemId: mid,
                  nameSnapshot: ln.nameSnapshot || "（商品）",
                  unitPrice: Math.round(Number(ln.unitPrice) || 0),
                  qty: Math.max(1, Math.floor(Number(ln.qty) || 1)),
                  note: ln.note ?? null,
                  lineExtra: (ln.lineExtra ?? undefined) as Prisma.InputJsonValue | undefined,
                  eatMode: ln.eatMode === "takeout" ? "takeout" : "dine_in",
                  taxRatePercent: Number(ln.taxRatePercent) || 10,
                  status: "served",
                  readyAt: ln.readyAt ? new Date(ln.readyAt) : closedAt,
                  servedAt: ln.servedAt ? new Date(ln.servedAt) : closedAt,
                },
              });
            }
          }
          const bill = await tx.bill.create({
            data: {
              storeId,
              sessionId: session.id,
              label,
              discountJson: (billIn.discountJson ?? undefined) as Prisma.InputJsonValue | undefined,
              totalAmount: Math.round(Number(billIn.totalAmount) || 0),
              status: "settled",
              settledAt: billIn.settledAt ? new Date(billIn.settledAt) : closedAt,
              createdAt: openedAt,
            },
          });
          for (const p of billIn.payments || []) {
            await tx.payment.create({
              data: {
                billId: bill.id,
                methodCode: p.methodCode || "other",
                amount: Math.round(Number(p.amount) || 0),
                note: p.note ?? `emergency import ${body.exportId}`,
                createdAt: p.createdAt ? new Date(p.createdAt) : closedAt,
              },
            });
          }
        });
        imported += 1;
      }

      await appendStaffAuditFromRequest(req, storeId, staffSub(req), "emergency_import", {
        exportId: body.exportId,
        imported,
        skippedDup,
        skippedNoTable,
      });

      return {
        ok: true,
        exportId: body.exportId,
        imported,
        skippedDup,
        skippedNoTable,
      };
    },
  );
}
