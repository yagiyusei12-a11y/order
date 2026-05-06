import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { openSessionForTable } from "../lib/open-table-session.js";

type SeatStatus = "vacant" | "reserved" | "occupied" | "cleaning" | "closed";

function todayShiftKeyInJst(): string {
  const now = new Date();
  // JST date string YYYY-MM-DD
  const jst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hr = jst.getUTCHours();
  const shift = hr < 15 ? "lunch" : "dinner";
  return `${y}-${m}-${d}_${shift}`;
}

async function ensureReceptionRows(storeId: string): Promise<void> {
  await prisma.receptionConfig.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
  });
  await prisma.receptionState.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
  });
}

async function ensureShift(storeId: string, shiftKey: string): Promise<void> {
  const found = await prisma.receptionShift.findUnique({
    where: { storeId_shiftKey: { storeId, shiftKey } },
    select: { id: true },
  });
  if (found) return;
  await prisma.receptionShift.create({
    data: { storeId, shiftKey, seats: [], waiting: [] },
  });
}

async function computeDefaultSeatsForShift(storeId: string): Promise<
  { id: string; status: SeatStatus; current: number; cleanStart: number | null; entryTime: number | null }[]
> {
  const tables = await prisma.table.findMany({
    where: { storeId, active: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, publicCode: true },
  });
  const sessions = await prisma.diningSession.findMany({
    where: { storeId, status: { in: ["open", "bashing_waiting"] } },
    select: { id: true, tableId: true, status: true, guestCount: true, openedAt: true },
  });
  const sessByTableId = new Map(sessions.map((s) => [s.tableId, s]));
  const out: { id: string; status: SeatStatus; current: number; cleanStart: number | null; entryTime: number | null }[] =
    [];
  for (const t of tables) {
    const s = sessByTableId.get(t.id);
    if (!s) {
      out.push({ id: t.publicCode, status: "vacant", current: 0, cleanStart: null, entryTime: null });
      continue;
    }
    if (s.status === "bashing_waiting") {
      out.push({
        id: t.publicCode,
        status: "cleaning",
        current: Number(s.guestCount || 0),
        cleanStart: Date.now(),
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
      });
    } else {
      out.push({
        id: t.publicCode,
        status: "occupied",
        current: Number(s.guestCount || 0),
        cleanStart: null,
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
      });
    }
  }
  return out;
}

async function syncSeatToSessions(storeId: string, seatId: string, next: SeatStatus, current: number): Promise<void> {
  const table = await prisma.table.findFirst({
    where: { storeId, active: true, publicCode: seatId },
    select: { id: true },
  });
  if (!table) return;

  const open = await prisma.diningSession.findFirst({
    where: { storeId, tableId: table.id, status: "open" },
    select: { id: true },
  });
  const bash = await prisma.diningSession.findFirst({
    where: { storeId, tableId: table.id, status: "bashing_waiting" },
    select: { id: true },
  });

  if (next === "occupied") {
    if (!open) {
      await openSessionForTable({
        tableId: table.id,
        storeId,
        guestCount: Math.max(1, Number.isFinite(current) ? Math.floor(current) : 1),
        childCount: 0,
        courseId: null,
        mode: "reuseIfOpen",
      });
    }
    return;
  }
  if (next === "cleaning") {
    if (open) {
      await prisma.diningSession.update({ where: { id: open.id }, data: { status: "bashing_waiting" } });
    }
    return;
  }
  if (next === "vacant") {
    if (open) {
      await prisma.diningSession.update({ where: { id: open.id }, data: { status: "closed", closedAt: new Date() } });
    }
    if (bash) {
      await prisma.diningSession.update({ where: { id: bash.id }, data: { status: "closed", closedAt: new Date() } });
    }
  }
}

export async function registerReception(app: FastifyInstance): Promise<void> {
  /**
   * 旧 api.php 互換の read API
   * - shiftKey が無ければ「今日の lunch/dinner」を使う
   */
  app.get<{ Params: { storeId: string }; Querystring: { shiftKey?: string } }>(
    "/reception/:storeId/state",
    async (req, reply) => {
      const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const shiftKey = (req.query.shiftKey || "").trim() || todayShiftKeyInJst();

      await ensureReceptionRows(store.id);
      await ensureShift(store.id, shiftKey);

      const [conf, st, sh, reservations] = await Promise.all([
        prisma.receptionConfig.findUnique({ where: { storeId: store.id } }),
        prisma.receptionState.findUnique({ where: { storeId: store.id } }),
        prisma.receptionShift.findUnique({ where: { storeId_shiftKey: { storeId: store.id, shiftKey } } }),
        prisma.receptionReservation.findMany({ where: { storeId: store.id } }),
      ]);

      // seats が空なら、卓/セッションから初期化（互換維持）
      let seats = Array.isArray((sh?.seats as unknown) as unknown[]) ? (sh?.seats as unknown[]) : [];
      let waiting = Array.isArray((sh?.waiting as unknown) as unknown[]) ? (sh?.waiting as unknown[]) : [];
      if (!seats || seats.length === 0) {
        const initSeats = await computeDefaultSeatsForShift(store.id);
        seats = initSeats as unknown[];
        await prisma.receptionShift.update({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
          data: { seats: initSeats as never },
        });
      }

      return {
        config: conf ? conf.data : { staff: 6, override: false, manualWait: 30 },
        callReserved: Boolean(st?.callReserved),
        callType: st?.callType ?? "",
        entryQueue: (st?.entryQueue ?? []) as unknown,
        shifts: {
          [shiftKey]: { seats, waiting },
        },
        reservations: reservations.map((r) => r.data),
      };
    },
  );

  /**
   * 旧 api.php 互換の write API（type + payload 形式）
   * 受付端末でも使えるよう、認証はかけない（店内ネットワーク前提）
   */
  app.post<{ Params: { storeId: string }; Body: Record<string, unknown> }>(
    "/reception/:storeId/event",
    async (req, reply) => {
      const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });
      await ensureReceptionRows(store.id);

      const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
      const type = typeof b.type === "string" ? b.type : "";
      const shiftKey = typeof b.shiftKey === "string" && b.shiftKey.trim() ? b.shiftKey.trim() : todayShiftKeyInJst();
      await ensureShift(store.id, shiftKey);

      if (type === "updateConfig") {
        const payload = (b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? b.payload : {}) as Record<
          string,
          unknown
        >;
        await prisma.receptionConfig.update({
          where: { storeId: store.id },
          data: { data: payload as never },
        });
        return { status: "success" };
      }
      if (type === "callReserved") {
        const callType = typeof b.callType === "string" ? b.callType : "normal";
        await prisma.receptionState.update({
          where: { storeId: store.id },
          data: { callReserved: true, callType },
        });
        return { status: "success" };
      }
      if (type === "resetCall") {
        await prisma.receptionState.update({
          where: { storeId: store.id },
          data: { callReserved: false, callType: "" },
        });
        return { status: "success" };
      }
      if (type === "popEntry") {
        const st = await prisma.receptionState.findUnique({ where: { storeId: store.id } });
        const q = Array.isArray((st?.entryQueue as unknown) as unknown[]) ? ((st?.entryQueue as unknown[]) ?? []) : [];
        q.shift();
        await prisma.receptionState.update({ where: { storeId: store.id }, data: { entryQueue: q as never } });
        return { status: "success" };
      }
      if (type === "addReservation") {
        const res = (b.reservation && typeof b.reservation === "object" && !Array.isArray(b.reservation)
          ? b.reservation
          : null) as Record<string, unknown> | null;
        const resId = res && typeof res.resId === "string" ? res.resId : "";
        const date = res && typeof res.date === "string" ? res.date : "";
        const shift = res && typeof res.shift === "string" ? res.shift : "";
        const status = res && typeof res.status === "string" ? res.status : null;
        if (!resId || !date || !shift) return reply.code(400).send({ error: "reservation needs resId/date/shift" });
        await prisma.receptionReservation.upsert({
          where: { storeId_resKey: { storeId: store.id, resKey: resId } },
          create: { storeId: store.id, resKey: resId, data: res as never, date, shift, status },
          update: { data: res as never, date, shift, status },
        });
        return { status: "success" };
      }
      if (type === "bulkUpdateReservations") {
        const arr = Array.isArray(b.reservations) ? (b.reservations as unknown[]) : [];
        for (const row of arr) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const r = row as Record<string, unknown>;
          const resId = typeof r.resId === "string" ? r.resId : "";
          const date = typeof r.date === "string" ? r.date : "";
          const shift = typeof r.shift === "string" ? r.shift : "";
          const status = typeof r.status === "string" ? r.status : null;
          if (!resId || !date || !shift) continue;
          await prisma.receptionReservation.upsert({
            where: { storeId_resKey: { storeId: store.id, resKey: resId } },
            create: { storeId: store.id, resKey: resId, data: r as never, date, shift, status },
            update: { data: r as never, date, shift, status },
          });
        }
        return { status: "success" };
      }

      if (type === "updateAll" || type === "updateSeats") {
        const seats = Array.isArray(b.seats) ? (b.seats as unknown[]) : null;
        const waiting = Array.isArray(b.waiting) ? (b.waiting as unknown[]) : null;
        if (type === "updateAll") {
          if (seats && seats.length > 0) {
            await prisma.receptionShift.update({
              where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
              data: {
                seats: seats as never,
                waiting: waiting ? (waiting as never) : undefined,
              },
            });
          }
          if (b.newEntry !== undefined) {
            const st = await prisma.receptionState.findUnique({ where: { storeId: store.id } });
            const q = Array.isArray((st?.entryQueue as unknown) as unknown[]) ? ((st?.entryQueue as unknown[]) ?? []) : [];
            q.push(b.newEntry);
            await prisma.receptionState.update({ where: { storeId: store.id }, data: { entryQueue: q as never } });
          }
        } else if (type === "updateSeats") {
          if (!seats || seats.length === 0) return reply.code(400).send({ error: "payload required" });
          await prisma.receptionShift.update({
            where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
            data: { seats: seats as never },
          });
        }

        // セッション同期（席データ内の status/current を利用）
        const syncSeats = (seats ?? []) as unknown[];
        for (const row of syncSeats) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : "";
          const st = typeof r.status === "string" ? r.status : "";
          const cur = typeof r.current === "number" ? r.current : 0;
          if (!id) continue;
          if (st === "occupied" || st === "cleaning" || st === "vacant") {
            await syncSeatToSessions(store.id, id, st as SeatStatus, cur);
          }
        }

        return { status: "success" };
      }

      return reply.code(400).send({ error: "unknown type" });
    },
  );
}

