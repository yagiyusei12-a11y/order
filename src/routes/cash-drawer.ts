import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { assertManagerRole } from "../lib/staff-role.js";

function staffUserIdFromReq(req: { user?: unknown }): string | null {
  const u = req.user as { sub?: unknown } | undefined;
  const sub = u && typeof u.sub === "string" ? u.sub : "";
  return sub || null;
}

async function latestBalanceYen(storeId: string): Promise<number> {
  const last = await prisma.cashDrawerEntry.findFirst({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterYen: true },
  });
  return last?.balanceAfterYen ?? 0;
}

export async function registerCashDrawerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { take?: string };
  }>("/stores/:storeId/cash-drawer", async (req, reply) => {
    const storeId = req.params.storeId;
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const takeRaw = Number(req.query?.take);
    const take = Number.isFinite(takeRaw) ? Math.min(200, Math.max(1, Math.floor(takeRaw))) : 100;

    const balanceYen = await latestBalanceYen(storeId);
    const rows = await prisma.cashDrawerEntry.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take,
      include: { staff: { select: { email: true, name: true } } },
    });

    return {
      storeId,
      balanceYen,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        amountDeltaYen: r.amountDeltaYen,
        balanceAfterYen: r.balanceAfterYen,
        countedYen: r.countedYen,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        actor: r.staff ? { email: r.staff.email, name: r.staff.name } : null,
      })),
    };
  });

  app.post<{
    Params: { storeId: string };
    Body: { note?: unknown };
  }>("/stores/:storeId/cash-drawer/open", async (req, reply) => {
    const storeId = req.params.storeId;
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const staffId = staffUserIdFromReq(req);
    const note =
      typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : undefined;

    const row = await prisma.$transaction(async (tx) => {
      const balance = await latestBalanceInTx(tx, storeId);
      return tx.cashDrawerEntry.create({
        data: {
          storeId,
          staffUserId: staffId,
          kind: "drawer_open",
          amountDeltaYen: 0,
          balanceAfterYen: balance,
          countedYen: null,
          note: note || null,
        },
      });
    });

    await appendStaffAuditFromRequest(req, storeId, staffId, "cash_drawer_open", {
      entryId: row.id,
      balanceYen: row.balanceAfterYen,
      note: row.note,
    });

    return {
      ok: true,
      entry: {
        id: row.id,
        kind: row.kind,
        amountDeltaYen: row.amountDeltaYen,
        balanceAfterYen: row.balanceAfterYen,
        createdAt: row.createdAt.toISOString(),
      },
    };
  });

  app.post<{
    Params: { storeId: string };
    Body: { kind?: unknown; amountYen?: unknown; countedYen?: unknown; note?: unknown };
  }>("/stores/:storeId/cash-drawer/movement", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;

    const storeId = req.params.storeId;
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const staffId = staffUserIdFromReq(req);
    const kindRaw = req.body?.kind;
    const kind = typeof kindRaw === "string" ? kindRaw.trim() : "";
    if (kind !== "to_bank" && kind !== "from_bank" && kind !== "count_reconcile") {
      return reply.code(400).send({ error: "kind must be to_bank, from_bank, or count_reconcile" });
    }

    const note =
      typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : undefined;

    let amountDeltaYen = 0;
    let countedYen: number | null = null;

    if (kind === "to_bank" || kind === "from_bank") {
      const ay = req.body?.amountYen;
      const n = typeof ay === "number" ? ay : typeof ay === "string" ? Number(ay) : NaN;
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return reply.code(400).send({ error: "amountYen must be a positive integer" });
      }
      amountDeltaYen = kind === "to_bank" ? -n : n;
    } else {
      const cy = req.body?.countedYen;
      const n = typeof cy === "number" ? cy : typeof cy === "string" ? Number(cy) : NaN;
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return reply.code(400).send({ error: "countedYen must be a non-negative integer" });
      }
      countedYen = n;
    }

    try {
      const row = await prisma.$transaction(async (tx) => {
        const current = await latestBalanceInTx(tx, storeId);
        if (kind === "count_reconcile" && countedYen != null) {
          amountDeltaYen = countedYen - current;
        }
        const balanceAfterYen = current + amountDeltaYen;
        if (balanceAfterYen < 0) {
          throw new Error("NEGATIVE_BALANCE");
        }
        return tx.cashDrawerEntry.create({
          data: {
            storeId,
            staffUserId: staffId,
            kind,
            amountDeltaYen,
            balanceAfterYen,
            countedYen: kind === "count_reconcile" ? countedYen : null,
            note: note || null,
          },
        });
      });

      await appendStaffAuditFromRequest(req, storeId, staffId, "cash_drawer_movement", {
        entryId: row.id,
        kind: row.kind,
        amountDeltaYen: row.amountDeltaYen,
        balanceAfterYen: row.balanceAfterYen,
        countedYen: row.countedYen,
        note: row.note,
      });

      return {
        ok: true,
        entry: {
          id: row.id,
          kind: row.kind,
          amountDeltaYen: row.amountDeltaYen,
          balanceAfterYen: row.balanceAfterYen,
          countedYen: row.countedYen,
          createdAt: row.createdAt.toISOString(),
        },
      };
    } catch (e) {
      if (e instanceof Error && e.message === "NEGATIVE_BALANCE") {
        return reply.code(400).send({ error: "resulting balance would be negative" });
      }
      throw e;
    }
  });
}

async function latestBalanceInTx(tx: Prisma.TransactionClient, storeId: string): Promise<number> {
  const last = await tx.cashDrawerEntry.findFirst({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterYen: true },
  });
  return last?.balanceAfterYen ?? 0;
}
