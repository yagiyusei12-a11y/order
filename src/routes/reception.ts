import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { openSessionForTable } from "../lib/open-table-session.js";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import {
  netReserveSlotKey,
  shiftFromTimeHHMM,
  legacyDaypartShiftKey,
  listNetReserveSlotTimes,
  isTimeInNetReserveSlots,
  effectiveNetReserveWindowsFromConfig,
} from "../lib/net-reserve-slots.js";
import {
  addCalendarDaysInWallZone,
  calendarDayDiffInWallZone,
  startOfWallCalendarDayUtc,
  storeNowWallClock,
} from "../lib/store-wall-time.js";
import { displayTableCode, tableDisplayLabel } from "../lib/table-display-code.js";

type SeatStatus = "vacant" | "reserved" | "occupied" | "cleaning" | "closed";

/** receptionConfig.data: ランチ/ディナー境界（時）。未設定は 15。 */
function receptionLunchEndHour(configData: Record<string, unknown>): number {
  const n = Number(configData.receptionShiftLunchEndHour);
  if (!Number.isFinite(n)) return 15;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

function buildTodayShiftKey(timeZone: string, lunchEndHour: number): string {
  const { dateYmd, timeHHMM } = storeNowWallClock(timeZone);
  const shift = shiftFromTimeHHMM(timeHHMM, lunchEndHour) ?? "dinner";
  return `${dateYmd}_${shift}`;
}

function parseShiftKey(shiftKey: string): { date: string; shift: "lunch" | "dinner" } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(lunch|dinner)$/.exec(shiftKey);
  if (!m) return null;
  return { date: m[1], shift: m[2] === "dinner" ? "dinner" : "lunch" };
}

function applyReservationBlocksToSeats(input: {
  shiftKey: string;
  seats: unknown[];
  reservations: unknown[];
  storeTimeZone: string;
}): unknown[] {
  const parsed = parseShiftKey(input.shiftKey);
  if (!parsed) return input.seats;
  const { date, shift } = parsed;
  const now = storeNowWallClock(input.storeTimeZone);
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
        const base = startOfWallCalendarDayUtc(date, input.storeTimeZone).getTime();
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

function pickReservationSeats(input: {
  tables: { code: string; capacity: number; mergeWith: string[] }[];
  used: Set<string>;
  num: number;
  maxMergeSize?: number;
  allOrNothingGroups?: string[][];
}): string[] | null {
  const { tables, used, num } = input;
  const maxMergeSize = Math.max(1, Number.isFinite(Number(input.maxMergeSize)) ? Math.floor(Number(input.maxMergeSize)) : 10);
  const allOrNothingGroups = Array.isArray(input.allOrNothingGroups) ? input.allOrNothingGroups : [];

  const byCode = new Map<string, { code: string; capacity: number; mergeWith: string[] }>();
  for (const t of tables) byCode.set(t.code, t);

  const freeCodes = tables.map((t) => t.code).filter((c) => c && !used.has(c));
  const freeSet = new Set(freeCodes);

  // adjacency graph (undirected)
  const adj = new Map<string, Set<string>>();
  for (const c of freeCodes) adj.set(c, new Set());
  for (const t of tables) {
    if (!freeSet.has(t.code)) continue;
    for (const o of (t.mergeWith || [])) {
      if (!freeSet.has(o)) continue;
      adj.get(t.code)?.add(o);
      adj.get(o)?.add(t.code);
    }
  }

  const groups: { set: Set<string>; arr: string[] }[] = allOrNothingGroups
    .filter((g) => Array.isArray(g) && g.every((x) => typeof x === "string"))
    .map((g) => g.map(String).filter((x) => freeSet.has(x)))
    .filter((g) => g.length >= 2)
    .map((arr) => ({ arr, set: new Set(arr) }));

  function violatesAllOrNothing(sub: Set<string>): boolean {
    for (const g of groups) {
      let hit = false;
      for (const x of g.arr) { if (sub.has(x)) { hit = true; break; } }
      if (!hit) continue;
      for (const x of g.arr) { if (!sub.has(x)) return true; }
    }
    return false;
  }

  function isConnected(subArr: string[]): boolean {
    if (subArr.length <= 1) return true;
    const sub = new Set(subArr);
    const q: string[] = [subArr[0]];
    const seen = new Set<string>([subArr[0]]);
    while (q.length) {
      const cur = q.pop()!;
      for (const nx of (adj.get(cur) || [])) {
        if (!sub.has(nx) || seen.has(nx)) continue;
        seen.add(nx);
        q.push(nx);
      }
    }
    return seen.size === sub.size;
  }

  let bestIds: string[] | null = null;
  let bestCap = Infinity;
  let bestLen = Infinity;
  const visited = new Set<string>();

  for (const start of freeCodes) {
    if (visited.has(start)) continue;
    // build component
    const comp: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nx of (adj.get(cur) || [])) {
        if (visited.has(nx)) continue;
        visited.add(nx);
        stack.push(nx);
      }
    }
    if (comp.length === 0) continue;

    // enumerate subsets up to maxMergeSize (cap-aware pruning)
    const compSorted = comp.slice().sort();
    const nComp = compSorted.length;
    const limit = Math.min(maxMergeSize, nComp);

    // simple subset enumeration for up to ~13 seats is fine (2^13=8192)
    // For larger comps, we still cap by maxMergeSize so enumerations stay reasonable.
    function backtrack(idx: number, chosen: string[]) {
      if (chosen.length > 0) {
        const subSet = new Set(chosen);
        if (!violatesAllOrNothing(subSet) && isConnected(chosen)) {
          const cap = chosen.reduce((acc, id) => acc + (byCode.get(id)?.capacity || 0), 0);
          if (cap >= num) {
            const ids = chosen.slice().sort();
            const key = ids.join(",");
            const bestKey = bestIds ? bestIds.join(",") : "";
            if (
              cap < bestCap ||
              (cap === bestCap && ids.length < bestLen) ||
              (cap === bestCap && ids.length === bestLen && key.localeCompare(bestKey) < 0)
            ) {
              bestIds = ids;
              bestCap = cap;
              bestLen = ids.length;
            }
          }
        }
      }
      if (idx >= nComp) return;
      if (chosen.length >= limit) return;

      // choose idx
      chosen.push(compSorted[idx]);
      backtrack(idx + 1, chosen);
      chosen.pop();
      // skip idx
      backtrack(idx + 1, chosen);
    }
    backtrack(0, []);
  }

  return bestIds;
}

async function collectUsedSeatsForNetReservation(
  tx: Prisma.TransactionClient,
  storeId: string,
  date: string,
  timeHHMM: string,
  lunchEndHour: number,
): Promise<Set<string>> {
  const shift = shiftFromTimeHHMM(timeHHMM, lunchEndHour);
  if (!shift) return new Set();
  const legacyKey = legacyDaypartShiftKey(date, shift);
  const slotKey = netReserveSlotKey(date, timeHHMM);
  if (!slotKey) return new Set();

  const used = new Set<string>();
  const locks = await tx.receptionReservationSeat.findMany({
    where: { storeId, shiftKey: { in: [slotKey, legacyKey] } },
    select: { seatId: true },
  });
  for (const l of locks) used.add(l.seatId);

  const sh = await tx.receptionShift.findUnique({
    where: { storeId_shiftKey: { storeId, shiftKey: legacyKey } },
  });
  const seatsNow = Array.isArray((sh?.seats as unknown) as unknown[]) ? ((sh?.seats as unknown[]) ?? []) : [];
  for (const row of seatsNow) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const st = typeof o.status === "string" ? o.status : "";
    if (!id) continue;
    if (st && st !== "vacant") used.add(id);
  }
  return used;
}

function netReserveSlotStepMinutes(c: Record<string, unknown>): number {
  const n = Number(c.netReserveSlotMinutes);
  if (!Number.isFinite(n)) return 15;
  return Math.max(5, Math.min(60, Math.floor(n)));
}

function filterNetSlotsNotPast(dateYmd: string, slotTimes: string[], timezone: string): string[] {
  const todayYmd = storeNowWallClock(timezone).dateYmd;
  if (dateYmd !== todayYmd) return dateYmd < todayYmd ? [] : slotTimes;
  const nowMin = minutesSinceMidnightInTimeZone(new Date(), timezone);
  const buffer = 5;
  return slotTimes.filter((t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return false;
    const tm = Number(m[1]) * 60 + Number(m[2]);
    return tm >= nowMin + buffer;
  });
}

async function syncReservationSeatLocks(input: {
  storeId: string;
  resKey: string;
  shiftKey: string;
  seats: string[];
  status: string | null | undefined;
}): Promise<void> {
  const { storeId, resKey, shiftKey, seats, status } = input;
  await prisma.receptionReservationSeat.deleteMany({ where: { storeId, resKey } });
  if (status === "キャンセル") return;
  const uniqueSeats = [...new Set(seats.filter((s) => typeof s === "string" && s))];
  if (uniqueSeats.length === 0) return;
  await prisma.receptionReservationSeat.createMany({
    data: uniqueSeats.map((seatId) => ({ storeId, resKey, shiftKey, seatId })),
  });
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
  const rxSeatCode = /^(?:[A-Za-z0-9_-]+-)?(C\d+|T\d+|\d+)$/i;
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
    if (!rxSeatCode.test(t.publicCode)) continue;
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

type DerivedSeatRow = Awaited<ReturnType<typeof computeDefaultSeatsForShift>>[number];

/**
 * オペ・卓QR等で DiningSession が変わっても、保存済み receptionShift.seats が古いままになる。
 * DB のライブ状態（derived）で席の占有・清掃を上書きし、予約ブロック処理の前に合わせる。
 * reserved は derived が vacant のとき維持（applyReservationBlocksToSeats が後段で再適用）。
 */
function mergeShiftSeatsWithLiveDerived(seats: unknown[], derived: DerivedSeatRow[]): unknown[] {
  const byId = new Map(derived.map((d) => [d.id, d]));
  return seats.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const o = { ...(row as Record<string, unknown>) };
    const id = typeof o.id === "string" ? o.id : "";
    const d = id ? byId.get(id) : undefined;
    if (!d) return row;
    if (d.status === "occupied" || d.status === "cleaning") {
      o.status = d.status;
      o.current = d.current;
      o.cleanStart = d.cleanStart;
      o.entryTime = d.entryTime;
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
      return o;
    }
    if (o.status === "occupied" || o.status === "cleaning") {
      o.status = d.status;
      o.current = d.current;
      o.cleanStart = d.cleanStart;
      o.entryTime = d.entryTime;
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
    } else {
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
    }
    return o;
  });
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
    const nextCount = Math.max(1, Number.isFinite(current) ? Math.floor(current) : 1);
    // If bashing_waiting exists, reuse it (avoid creating 2 sessions per table)
    if (!open && bash) {
      await prisma.diningSession.update({ where: { id: bash.id }, data: { status: "open", guestCount: nextCount, closedAt: null } });
      return;
    }
    if (!open) {
      await openSessionForTable({
        tableId: table.id,
        storeId,
        guestCount: nextCount,
        childCount: 0,
        courseId: null,
        mode: "reuseIfOpen",
      });
      return;
    }
    // Keep guestCount in sync
    await prisma.diningSession.update({ where: { id: open.id }, data: { guestCount: nextCount } });
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
      await ensureReceptionRows(store.id);
      const stSet = mergeStoreSettings(store.settings);
      const confRow = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
      const cData = (confRow?.data as Record<string, unknown>) || {};
      const lunchEnd = receptionLunchEndHour(cData);
      const shiftKey =
        (req.query.shiftKey || "").trim() || buildTodayShiftKey(stSet.timezone, lunchEnd);

      await ensureShift(store.id, shiftKey);

      const [conf, st, sh, reservations, derivedLive] = await Promise.all([
        prisma.receptionConfig.findUnique({ where: { storeId: store.id } }),
        prisma.receptionState.findUnique({ where: { storeId: store.id } }),
        prisma.receptionShift.findUnique({ where: { storeId_shiftKey: { storeId: store.id, shiftKey } } }),
        prisma.receptionReservation.findMany({ where: { storeId: store.id } }),
        computeDefaultSeatsForShift(store.id),
      ]);

      // 旧 index.html の Etag キャッシュ互換（内容が変わらなければ 304）
      // ※ DiningSession だけ変わった場合も再取得できるようライブ席スナップショットを含める
      const maxResUpdatedAt = reservations.reduce((acc, r) => Math.max(acc, r.updatedAt?.getTime?.() ?? 0), 0);
      const liveSeatSig = derivedLive
        .map((s) => `${s.id}:${s.status}:${s.current}`)
        .sort()
        .join(",");
      const etag = `W/"${[
        conf?.updatedAt?.getTime?.() ?? 0,
        st?.updatedAt?.getTime?.() ?? 0,
        sh?.updatedAt?.getTime?.() ?? 0,
        maxResUpdatedAt,
        liveSeatSig,
      ].join("-")}"`;
      const inm = (req.headers["if-none-match"] || "").toString();
      reply.header("Etag", etag);
      if (inm === etag) return reply.code(304).send();

      // seats が空なら、卓/セッションから初期化（互換維持）
      let seats = Array.isArray((sh?.seats as unknown) as unknown[]) ? (sh?.seats as unknown[]) : [];
      let waiting = Array.isArray((sh?.waiting as unknown) as unknown[]) ? (sh?.waiting as unknown[]) : [];
      if (!seats || seats.length === 0) {
        seats = derivedLive as unknown[];
        await prisma.receptionShift.update({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
          data: { seats: derivedLive as never },
        });
      } else {
        seats = mergeShiftSeatsWithLiveDerived(seats, derivedLive) as unknown[];
      }

      const seatsWithBlocks = applyReservationBlocksToSeats({
        shiftKey,
        seats: seats as unknown[],
        reservations: reservations.map((r) => r.data) as unknown[],
        storeTimeZone: stSet.timezone,
      });

      const tableMaster = await prisma.table.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: "asc" },
        select: { publicCode: true, capacity: true, mergeWith: true, name: true },
      });
      const rxSeatCode = /^(?:[A-Za-z0-9_-]+-)?(C\d+|T\d+|\d+)$/i;
      const filteredMaster = tableMaster.filter((t) => rxSeatCode.test(t.publicCode));
      const fallbackMaster =
        seatsWithBlocks
          .map((x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as any).id : ""))
          .filter((x) => typeof x === "string" && x)
          .map((id) => ({ code: id, name: id, capacity: 2, mergeWith: [] }));

      return {
        config: conf ? conf.data : { staff: 6, override: false, manualWait: 30 },
        callReserved: Boolean(st?.callReserved),
        callType: st?.callType ?? "",
        entryQueue: (st?.entryQueue ?? []) as unknown,
        tableMaster: (filteredMaster.length > 0 ? filteredMaster.map((t) => ({
          code: t.publicCode,
          name: t.name,
          capacity: Math.max(1, Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : 2),
          mergeWith: Array.isArray(t.mergeWith) ? (t.mergeWith as unknown[]).filter((x) => typeof x === "string") : [],
        })) : fallbackMaster),
        shifts: {
          [shiftKey]: { seats: seatsWithBlocks, waiting, updatedAt: sh?.updatedAt ? sh.updatedAt.getTime() : 0 },
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
      const stSetEv = mergeStoreSettings(store.settings);
      const confEv = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
      const cEv = (confEv?.data as Record<string, unknown>) || {};
      const lunchEndEv = receptionLunchEndHour(cEv);

      const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
      const type = typeof b.type === "string" ? b.type : "";
      const shiftKey =
        typeof b.shiftKey === "string" && b.shiftKey.trim()
          ? b.shiftKey.trim()
          : buildTodayShiftKey(stSetEv.timezone, lunchEndEv);
      await ensureShift(store.id, shiftKey);

      if (type === "updateConfig") {
        const payload = (b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? b.payload : {}) as Record<
          string,
          unknown
        >;
        const curRow = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
        const prev =
          curRow?.data && typeof curRow.data === "object" && !Array.isArray(curRow.data)
            ? (curRow.data as Record<string, unknown>)
            : {};
        const next = { ...prev };
        for (const [k, v] of Object.entries(payload)) {
          if (v === null || v === undefined) delete next[k];
          else next[k] = v;
        }
        await prisma.receptionConfig.update({
          where: { storeId: store.id },
          data: { data: next as never },
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
        const seats = Array.isArray((res as any)?.seats) ? ((res as any).seats as unknown[]).filter((x) => typeof x === "string") as string[] : [];
        await syncReservationSeatLocks({ storeId: store.id, resKey: resId, shiftKey: `${date}_${shift}`, seats, status });
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
          const seats = Array.isArray((r as any)?.seats) ? ((r as any).seats as unknown[]).filter((x) => typeof x === "string") as string[] : [];
          await syncReservationSeatLocks({ storeId: store.id, resKey: resId, shiftKey: `${date}_${shift}`, seats, status });
        }
        return { status: "success" };
      }

      if (type === "updateAll" || type === "updateSeats") {
        // 旧 api.php / index.html 互換: updateSeats は payload に seats が入る
        const seats = Array.isArray(b.seats) ? (b.seats as unknown[]) : (Array.isArray(b.payload) ? (b.payload as unknown[]) : null);
        const waiting = Array.isArray(b.waiting) ? (b.waiting as unknown[]) : null;
        const ifShiftUpdatedAt = typeof b.ifShiftUpdatedAt === "number" ? b.ifShiftUpdatedAt : null;
        if (ifShiftUpdatedAt !== null) {
          const cur = await prisma.receptionShift.findUnique({
            where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
            select: { updatedAt: true },
          });
          const curMs = cur?.updatedAt ? cur.updatedAt.getTime() : 0;
          if (curMs && curMs !== ifShiftUpdatedAt) {
            return reply.code(409).send({ error: "STALE_SHIFT", currentUpdatedAt: curMs });
          }
        }
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
    const st = mergeStoreSettings(store.settings);
    const windows = effectiveNetReserveWindowsFromConfig(c as Record<string, unknown>);
    const slotMinutes = netReserveSlotStepMinutes(c as Record<string, unknown>);
    const todayYmd = storeNowWallClock(st.timezone).dateYmd;
    const maxReservableYmd =
      addCalendarDaysInWallZone(todayYmd, daysAhead, st.timezone) ?? todayYmd;
    const shiftLunchEndHour = receptionLunchEndHour(c as Record<string, unknown>);
    const netReserveFallbackToTemplateWindows = c.netReserveFallbackToTemplateWindows !== false;
    return {
      storeId: store.id,
      daysAhead,
      enableNote,
      timezone: st.timezone,
      slotMinutes,
      businessWindows: windows,
      todayYmd,
      maxReservableYmd,
      shiftLunchEndHour,
      netReserveFallbackToTemplateWindows,
    };
  });

  /**
   * ネット予約: 人数別の空き枠（公開）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { date?: string; partySize?: string };
  }>("/reception/:storeId/net/availability", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);

    const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const c = (conf?.data as any) || {};
    const daysAhead = Number.isFinite(Number(c.netReserveDaysAhead)) ? Number(c.netReserveDaysAhead) : 30;

    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
    const partySize = Number(req.query.partySize);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: "invalid date" });
    if (!Number.isFinite(partySize) || partySize < 1 || partySize > 20) {
      return reply.code(400).send({ error: "partySize must be 1..20" });
    }

    const stSet = mergeStoreSettings(store.settings);
    const todayYmd = storeNowWallClock(stSet.timezone).dateYmd;
    const diff = calendarDayDiffInWallZone(todayYmd, date, stSet.timezone);
    if (diff === null) return reply.code(400).send({ error: "invalid date" });
    if (diff < 0) return reply.code(400).send({ error: "past date not allowed" });
    if (diff > daysAhead) return reply.code(403).send({ error: "date exceeds reservable range" });

    const lunchH = receptionLunchEndHour(c as Record<string, unknown>);
    const windows = effectiveNetReserveWindowsFromConfig(c as Record<string, unknown>);
    const step = netReserveSlotStepMinutes(c as Record<string, unknown>);
    let slotTimes = listNetReserveSlotTimes(windows, step);
    slotTimes = filterNetSlotsNotPast(date, slotTimes, stSet.timezone);

    const rxSeatCode = /^(?:[A-Za-z0-9_-]+-)?(C\d+|T\d+|\d+)$/i;
    const maxMergeSize = Number.isFinite(Number(c.maxMergeSize)) ? Number(c.maxMergeSize) : 10;
    const allOrNothingGroups = Array.isArray(c.mergeAllOrNothingGroups) ? c.mergeAllOrNothingGroups : [];
    const n = Math.floor(partySize);

    const slots = await prisma.$transaction(async (tx) => {
      const tables = await tx.table.findMany({
        where: { storeId: store.id, active: true },
        select: { publicCode: true, capacity: true, mergeWith: true },
        orderBy: { sortOrder: "asc" },
      });
      const tableMaster = tables.filter((t) => rxSeatCode.test(t.publicCode)).map((t) => ({
        code: t.publicCode,
        capacity: Number(t.capacity || 2),
        mergeWith: Array.isArray(t.mergeWith) ? t.mergeWith.filter((x) => typeof x === "string") as string[] : [],
      }));
      const out: { time: string; available: boolean }[] = [];
      for (const time of slotTimes) {
        const used = await collectUsedSeatsForNetReservation(tx, store.id, date, time, lunchH);
        const seats = pickReservationSeats({
          tables: tableMaster,
          used,
          num: n,
          maxMergeSize,
          allOrNothingGroups,
        });
        out.push({ time, available: seats !== null });
      }
      return out;
    });

    return { date, partySize: n, timezone: stSet.timezone, slots };
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
    const lunchHr = receptionLunchEndHour(c as Record<string, unknown>);
    const shift = shiftFromTimeHHMM(time, lunchHr);
    if (!shift) return reply.code(400).send({ error: "invalid time" });
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!Number.isFinite(num) || num < 1 || num > 20) return reply.code(400).send({ error: "num must be 1..20" });

    const stSet = mergeStoreSettings(store.settings);
    const todayYmdR = storeNowWallClock(stSet.timezone).dateYmd;
    const diff = calendarDayDiffInWallZone(todayYmdR, date, stSet.timezone);
    if (diff === null) return reply.code(400).send({ error: "invalid date" });
    if (diff < 0) return reply.code(400).send({ error: "past date not allowed" });
    if (diff > daysAhead) return reply.code(403).send({ error: "date exceeds reservable range" });

    const windows = effectiveNetReserveWindowsFromConfig(c as Record<string, unknown>);
    const step = netReserveSlotStepMinutes(c as Record<string, unknown>);
    const slotTimesAll = listNetReserveSlotTimes(windows, step);
    if (!isTimeInNetReserveSlots(time, slotTimesAll)) {
      return reply.code(400).send({ error: "time not in business hours" });
    }
    const slotTimesToday = filterNetSlotsNotPast(date, slotTimesAll, stSet.timezone);
    if (!isTimeInNetReserveSlots(time, slotTimesToday)) {
      return reply.code(400).send({ error: "past time not allowed" });
    }

    const slotKeySnap = netReserveSlotKey(date, time);
    if (!slotKeySnap) return reply.code(400).send({ error: "invalid time" });

    const legacyKey = `${date}_${shift}`;
    await ensureShift(store.id, legacyKey);

    // Concurrency-safe seat assignment:
    // - Compute candidate seats
    // - Create reservation and per-seat locks in a transaction
    // - If a lock conflicts, retry by recomputing
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const resId = "N" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      try {
        const out = await prisma.$transaction(async (tx) => {
          const tables = await tx.table.findMany({
            where: { storeId: store.id, active: true },
            select: { publicCode: true, name: true, capacity: true, mergeWith: true },
            orderBy: { sortOrder: "asc" },
          });
          const rxSeatCode = /^(?:[A-Za-z0-9_-]+-)?(C\d+|T\d+|\d+)$/i;

          const used = await collectUsedSeatsForNetReservation(tx, store.id, date, time, lunchHr);

          const tableMaster = tables.filter((t) => rxSeatCode.test(t.publicCode)).map((t) => ({
            code: t.publicCode,
            capacity: Number(t.capacity || 2),
            mergeWith: Array.isArray(t.mergeWith) ? t.mergeWith.filter((x) => typeof x === "string") as string[] : [],
          }));
          const maxMergeSize = Number.isFinite(Number(c.maxMergeSize)) ? Number(c.maxMergeSize) : 10;
          const allOrNothingGroups = Array.isArray(c.mergeAllOrNothingGroups) ? c.mergeAllOrNothingGroups : [];
          const seats = pickReservationSeats({
            tables: tableMaster,
            used,
            num: Math.floor(num),
            maxMergeSize,
            allOrNothingGroups,
          });
          if (!seats) return { ok: false as const };

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

          await tx.receptionReservation.upsert({
            where: { storeId_resKey: { storeId: store.id, resKey: resId } },
            create: { storeId: store.id, resKey: resId, data: reservation as never, date, shift, status: "予約確定" },
            update: { data: reservation as never, date, shift, status: "予約確定" },
          });
          await tx.receptionReservationSeat.createMany({
            data: seats.map((seatId) => ({ storeId: store.id, shiftKey: slotKeySnap, seatId, resKey: resId })),
          });
          const labelByCode = new Map(
            tables.map((t) => [t.publicCode, tableDisplayLabel(t.name, t.publicCode)]),
          );
          const seatLabels = seats.map((id) => labelByCode.get(id) || displayTableCode(id) || id);
          return { ok: true as const, resId, seats, seatLabels };
        });

        if (!out.ok) return reply.code(409).send({ error: "no available seats" });
        return { ok: true, resId: out.resId, seats: out.seats, seatLabels: out.seatLabels };
      } catch (e: any) {
        const msg = String(e?.message || e);
        // Unique constraint hit means seat already locked; retry
        if (msg.includes("ReceptionReservationSeat_storeId_shiftKey_seatId_key")) continue;
        throw e;
      }
    }
    return reply.code(409).send({ error: "no available seats" });
  });
}

