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

function parseShiftKey(shiftKey: string): { date: string; shift: "lunch" | "dinner" } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(lunch|dinner)$/.exec(shiftKey);
  if (!m) return null;
  return { date: m[1], shift: m[2] === "dinner" ? "dinner" : "lunch" };
}

function jstNowParts(): { date: string; timeHHMM: string; nowMs: number } {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, timeHHMM: `${hh}:${mm}`, nowMs: now.getTime() };
}

function applyReservationBlocksToSeats(input: {
  shiftKey: string;
  seats: unknown[];
  reservations: unknown[];
}): unknown[] {
  const parsed = parseShiftKey(input.shiftKey);
  if (!parsed) return input.seats;
  const { date, shift } = parsed;
  const now = jstNowParts();
  const seats = input.seats.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? { ...(x as Record<string, unknown>) } : x));
  const seatById = new Map<string, Record<string, unknown>>();
  for (const s of seats) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const o = s as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id) continue;
    seatById.set(id, o);
    // 既定で false を付ける（旧 front.html の requirePure 用）
    if (!("hasFutureRes" in o)) o.hasFutureRes = false;
  }

  // 旧ロジック:
  // - 予約確定で同日同シフト
  // - time が無い→ブロック
  // - diffHours < 2.5 && diffHours > -2 → reserved でブロック
  // - diffHours >= 2.5 → hasFutureRes=true（ブロックしない）
  for (const row of input.reservations) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (r.status !== "予約確定") continue;
    if (r.date !== date) continue;
    if (r.shift !== shift) continue;
    const seatsArr = Array.isArray(r.seats) ? (r.seats as unknown[]) : [];
    const timeStr = typeof r.time === "string" ? r.time : "";

    let blockSeat = false;
    let hasFuture = false;
    if (!timeStr) {
      blockSeat = true;
    } else {
      const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
      if (!m) {
        blockSeat = true;
      } else {
        const hr = Number(m[1]);
        const min = Number(m[2]);
        // JST の今日の日付と予約日付の差分を作る（予約日のローカル時刻と比較）
        const base = new Date(`${date}T00:00:00.000+09:00`).getTime();
        const resMs = base + (hr * 60 + min) * 60 * 1000;
        const diffHours = (resMs - now.nowMs) / (1000 * 60 * 60);
        if (diffHours < 2.5 && diffHours > -2) blockSeat = true;
        else if (diffHours >= 2.5) hasFuture = true;
      }
    }

    for (const sidRaw of seatsArr) {
      const sid = typeof sidRaw === "string" ? sidRaw : "";
      if (!sid) continue;
      const seat = seatById.get(sid);
      if (!seat) continue;
      if (hasFuture) seat.hasFutureRes = true;
      if (blockSeat) {
        if (seat.status === "vacant") seat.status = "reserved";
      }
    }
  }
  return seats;
}

function jstTodayDateStr(): string {
  return jstNowParts().date;
}

function dayDiffJst(fromDate: string, toDate: string): number | null {
  // from/to: YYYY-MM-DD in JST
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null;
  const fromMs = new Date(`${fromDate}T00:00:00.000+09:00`).getTime();
  const toMs = new Date(`${toDate}T00:00:00.000+09:00`).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

function shiftFromTimeHHMM(time: string): "lunch" | "dinner" | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh < 15 ? "lunch" : "dinner";
}

function pickReservationSeats(input: {
  tables: { code: string; capacity: number; mergeWith: string[] }[];
  used: Set<string>;
  num: number;
}): string[] | null {
  const { tables, used, num } = input;
  const byCode = new Map<string, { code: string; capacity: number; mergeWith: string[] }>();
  for (const t of tables) byCode.set(t.code, t);

  const freeTables = tables.filter((t) => !used.has(t.code));
  // 1) single
  const single = freeTables
    .filter((t) => t.capacity >= num)
    .sort((a, b) => a.capacity - b.capacity)[0];
  if (single) return [single.code];

  // 2) pair merges
  type Pair = { a: string; b: string; cap: number };
  const pairs: Pair[] = [];
  for (const t of freeTables) {
    for (const otherCode of t.mergeWith || []) {
      const o = byCode.get(otherCode);
      if (!o) continue;
      if (used.has(o.code)) continue;
      if (o.code === t.code) continue;
      // avoid duplicates (a<b)
      const a = t.code < o.code ? t.code : o.code;
      const b = t.code < o.code ? o.code : t.code;
      const cap = (byCode.get(a)?.capacity || 0) + (byCode.get(b)?.capacity || 0);
      if (cap >= num) pairs.push({ a, b, cap });
    }
  }
  if (pairs.length) {
    pairs.sort((x, y) => x.cap - y.cap || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
    return [pairs[0].a, pairs[0].b];
  }

  // 3) triple (limited) via naive expansion
  type Triple = { ids: string[]; cap: number };
  const triples: Triple[] = [];
  const freeCodes = freeTables.map((t) => t.code);
  const freeSet = new Set(freeCodes);
  for (const a of freeCodes) {
    const ta = byCode.get(a);
    if (!ta) continue;
    const neighbors = (ta.mergeWith || []).filter((c) => freeSet.has(c));
    for (const b of neighbors) {
      if (b === a) continue;
      const tb = byCode.get(b);
      if (!tb) continue;
      const neigh2 = (tb.mergeWith || []).filter((c) => freeSet.has(c));
      for (const c of neigh2) {
        if (c === a || c === b) continue;
        const ids = [a, b, c].sort();
        const cap = (byCode.get(ids[0])?.capacity || 0) + (byCode.get(ids[1])?.capacity || 0) + (byCode.get(ids[2])?.capacity || 0);
        if (cap >= num) triples.push({ ids, cap });
      }
    }
  }
  if (triples.length) {
    triples.sort((x, y) => x.cap - y.cap || x.ids.join(",").localeCompare(y.ids.join(",")));
    return triples[0].ids;
  }
  return null;
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
  {
    id: string;
    status: SeatStatus;
    current: number;
    cleanStart: number | null;
    entryTime: number | null;
    capacity: number;
    mergeWith: string[];
  }[]
> {
  const tables = await prisma.table.findMany({
    where: { storeId, active: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, publicCode: true, capacity: true, mergeWith: true },
  });
  const sessions = await prisma.diningSession.findMany({
    where: { storeId, status: { in: ["open", "bashing_waiting"] } },
    select: { id: true, tableId: true, status: true, guestCount: true, openedAt: true },
  });
  const sessByTableId = new Map(sessions.map((s) => [s.tableId, s]));
  const out: {
    id: string;
    status: SeatStatus;
    current: number;
    cleanStart: number | null;
    entryTime: number | null;
    capacity: number;
    mergeWith: string[];
  }[] = [];
  for (const t of tables) {
    const s = sessByTableId.get(t.id);
    const mergeWith = Array.isArray(t.mergeWith)
      ? (t.mergeWith as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];
    const capacity = Math.max(1, Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : 2);
    if (!s) {
      out.push({ id: t.publicCode, status: "vacant", current: 0, cleanStart: null, entryTime: null, capacity, mergeWith });
      continue;
    }
    if (s.status === "bashing_waiting") {
      out.push({
        id: t.publicCode,
        status: "cleaning",
        current: Number(s.guestCount || 0),
        cleanStart: Date.now(),
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
        capacity,
        mergeWith,
      });
    } else {
      out.push({
        id: t.publicCode,
        status: "occupied",
        current: Number(s.guestCount || 0),
        cleanStart: null,
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
        capacity,
        mergeWith,
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

      // 旧 index.html の Etag キャッシュ互換（内容が変わらなければ 304）
      const maxResUpdatedAt = reservations.reduce((acc, r) => Math.max(acc, r.updatedAt?.getTime?.() ?? 0), 0);
      const etag = `W/"${[
        conf?.updatedAt?.getTime?.() ?? 0,
        st?.updatedAt?.getTime?.() ?? 0,
        sh?.updatedAt?.getTime?.() ?? 0,
        maxResUpdatedAt,
      ].join("-")}"`;
      const inm = (req.headers["if-none-match"] || "").toString();
      reply.header("Etag", etag);
      if (inm === etag) return reply.code(304).send();

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

      const seatsWithBlocks = applyReservationBlocksToSeats({
        shiftKey,
        seats: seats as unknown[],
        reservations: reservations.map((r) => r.data) as unknown[],
      });

      const tableMaster = await prisma.table.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: "asc" },
        select: { publicCode: true, capacity: true, mergeWith: true, name: true },
      });

      return {
        config: conf ? conf.data : { staff: 6, override: false, manualWait: 30 },
        callReserved: Boolean(st?.callReserved),
        callType: st?.callType ?? "",
        entryQueue: (st?.entryQueue ?? []) as unknown,
        tableMaster: tableMaster.map((t) => ({
          code: t.publicCode,
          name: t.name,
          capacity: Math.max(1, Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : 2),
          mergeWith: Array.isArray(t.mergeWith) ? (t.mergeWith as unknown[]).filter((x) => typeof x === "string") : [],
        })),
        shifts: {
          [shiftKey]: { seats: seatsWithBlocks, waiting },
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
        // 旧 api.php / index.html 互換: updateSeats は payload に seats が入る
        const seats = Array.isArray(b.seats) ? (b.seats as unknown[]) : (Array.isArray(b.payload) ? (b.payload as unknown[]) : null);
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

  /**
   * ネット予約: 設定取得（公開）
   */
  app.get<{ Params: { storeId: string } }>("/reception/:storeId/net/config", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);
    const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const c = (conf?.data as any) || {};
    const daysAhead = Number.isFinite(Number(c.netReserveDaysAhead)) ? Number(c.netReserveDaysAhead) : 30;
    const enableNote = c.netReserveEnableNote === undefined ? true : Boolean(c.netReserveEnableNote);
    return { storeId: store.id, daysAhead, enableNote };
  });

  /**
   * ネット予約: 予約登録（公開）
   */
  app.post<{
    Params: { storeId: string };
    Body: { date?: unknown; time?: unknown; name?: unknown; num?: unknown; note?: unknown };
  }>("/reception/:storeId/net/reservations", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);

    const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const c = (conf?.data as any) || {};
    const daysAhead = Number.isFinite(Number(c.netReserveDaysAhead)) ? Number(c.netReserveDaysAhead) : 30;
    const enableNote = c.netReserveEnableNote === undefined ? true : Boolean(c.netReserveEnableNote);

    const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";
    const time = typeof req.body?.time === "string" ? req.body.time.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const num = typeof req.body?.num === "number" ? req.body.num : Number(req.body?.num);
    const noteRaw = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const note = enableNote ? noteRaw : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: "invalid date" });
    const shift = shiftFromTimeHHMM(time);
    if (!shift) return reply.code(400).send({ error: "invalid time" });
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!Number.isFinite(num) || num < 1 || num > 20) return reply.code(400).send({ error: "num must be 1..20" });

    const diff = dayDiffJst(jstTodayDateStr(), date);
    if (diff === null) return reply.code(400).send({ error: "invalid date" });
    if (diff < 0) return reply.code(400).send({ error: "past date not allowed" });
    if (diff > daysAhead) return reply.code(403).send({ error: "date exceeds reservable range" });

    const shiftKey = `${date}_${shift}`;
    await ensureShift(store.id, shiftKey);

    const [tables, reservations, sh] = await Promise.all([
      prisma.table.findMany({
        where: { storeId: store.id, active: true },
        select: { publicCode: true, capacity: true, mergeWith: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.receptionReservation.findMany({ where: { storeId: store.id, date, shift } }),
      prisma.receptionShift.findUnique({ where: { storeId_shiftKey: { storeId: store.id, shiftKey } } }),
    ]);

    const used = new Set<string>();
    for (const r of reservations) {
      const d = r.data as any;
      if (d?.status === "キャンセル") continue;
      const seats = Array.isArray(d?.seats) ? d.seats : [];
      for (const s of seats) if (typeof s === "string" && s) used.add(s);
    }
    // 同日同シフトで既に occupied/cleaning/reserved になっている席は使用不可にする
    const seatsNow = Array.isArray((sh?.seats as unknown) as unknown[]) ? ((sh?.seats as unknown[]) ?? []) : [];
    for (const row of seatsNow) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const st = typeof o.status === "string" ? o.status : "";
      if (!id) continue;
      if (st && st !== "vacant") used.add(id);
    }

    const tableMaster = tables.map((t) => ({
      code: t.publicCode,
      capacity: Number(t.capacity || 2),
      mergeWith: Array.isArray(t.mergeWith) ? t.mergeWith.filter((x) => typeof x === "string") as string[] : [],
    }));
    const seats = pickReservationSeats({ tables: tableMaster, used, num: Math.floor(num) });
    if (!seats) return reply.code(409).send({ error: "no available seats" });

    const resId = "N" + Date.now();
    const reservation = {
      resId,
      date,
      shift,
      time,
      name,
      num: Math.floor(num),
      status: "予約確定",
      seats,
      note,
    };

    await prisma.receptionReservation.upsert({
      where: { storeId_resKey: { storeId: store.id, resKey: resId } },
      create: { storeId: store.id, resKey: resId, data: reservation as never, date, shift, status: "予約確定" },
      update: { data: reservation as never, date, shift, status: "予約確定" },
    });

    return { ok: true, resId, seats };
  });
}

