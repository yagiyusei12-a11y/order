import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import {
  isReservationWallDateTimeAllowed,
  isWallDateClosedByBusinessCalendar,
} from "../lib/store-order-gate.js";
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
import { isMailConfigured, sendMailSafe } from "../lib/mail.js";
import {
  netReserveGuestEmailFromData,
  netReserveStaffNotifyEmails,
  sendNetReserveCancelNotifications,
  sendNotifyEmailList,
} from "../lib/notify-emails.js";
import { staffRequestOrigin } from "../lib/guest-display-url.js";
import {
  buildTodayReceptionShiftKey,
  clearLegacyStaffCountBlocks,
  computeDefaultSeatsForShift,
  emptyDerivedSeatRows,
  isCurrentReceptionShiftKey,
  mergeShiftSeatsWithLiveDerived,
  stripLiveSessionStatesFromFutureShiftSeats,
  closeTableSessionsForReceptionMapClear,
  syncReceptionShiftSeatsForTable,
  type ReceptionSeatStatus,
} from "../lib/reception-seat-state.js";
import {
  isForbiddenManualReceptionSeatTransition,
  isSeatBlockedForBooking,
  normalizeReceptionSeatStatus,
} from "../lib/reception-seat-status.js";
import { broadcastReceptionUpdated } from "../lib/ops-seat-socket.js";
import {
  HARUNOYUKOTO_STORE_ID,
  pickHarunoyukotoSeats,
} from "../lib/harunoyukoto-seat-priority.js";

function netReserveReservationPrevStatus(
  row: { status: string | null; data: unknown } | null,
): string {
  if (!row) return "";
  const data =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  const fromData = typeof data.status === "string" ? data.status : "";
  return fromData || row.status || "";
}

async function maybeNotifyNetReserveCancelled(
  store: { id: string; name: string; settings: unknown },
  resId: string,
  prevStatus: string,
  res: Record<string, unknown>,
  status: string | null,
  receptionUrl: string,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  if (!resId.startsWith("N") || status !== "キャンセル" || prevStatus === "キャンセル") return;
  const stSet = mergeStoreSettings(store.settings);
  const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
  const c = (conf?.data as Record<string, unknown>) || {};
  try {
    await sendNetReserveCancelNotifications(
      {
        storeId: store.id,
        storeName: store.name,
        resKey: resId,
        date: typeof res.date === "string" ? res.date : "",
        time: typeof res.time === "string" ? res.time : "",
        name: typeof res.name === "string" ? res.name : "",
        num: typeof res.num === "number" ? res.num : Number(res.num) || 0,
        note: typeof res.note === "string" ? res.note : "",
        seatType: typeof res.seatType === "string" ? res.seatType : "",
        storedPhone: typeof res.phone === "string" ? res.phone : "",
        emailForMail: netReserveGuestEmailFromData(res),
        receptionConfig: c,
        storeSettings: stSet,
        receptionUrl,
      },
      log,
    );
  } catch (err: unknown) {
    log?.warn({ err, storeId: store.id, resId }, "net reserve cancel mail failed");
  }
}

function receptionMutationNotify(storeId: string): { status: "success" } {
  broadcastReceptionUpdated(storeId);
  return { status: "success" };
}

type SeatStatus = ReceptionSeatStatus;

/**
 * If-None-Match 用 ETag。Node の OutgoingMessage はヘッダ値を Latin-1 扱いのため、
 * 席種別（日本語など）を liveSeatSig / tableMasterSig に直書きすると例外 → 500 になりうる。
 */
function receptionStateWeakEtag(parts: (string | number)[]): string {
  const raw = parts.join("\x1e");
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  return `W/"${digest}"`;
}

function normalizePhoneDigits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

function normalizeReceptionPhone(raw: unknown): { ok: true; phone: string } | { ok: false } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { ok: false };
  const digits = normalizePhoneDigits(trimmed);
  if (digits.length < 10 || digits.length > 15) return { ok: false };
  return { ok: true, phone: trimmed.slice(0, 30) };
}

/** receptionConfig.data: ランチ/ディナー境界（時）。未設定は 15。 */
function receptionLunchEndHour(configData: Record<string, unknown>): number {
  const n = Number(configData.receptionShiftLunchEndHour);
  if (!Number.isFinite(n)) return 15;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

function buildTodayShiftKey(timeZone: string, lunchEndHour: number): string {
  return buildTodayReceptionShiftKey(timeZone, lunchEndHour);
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
  let now;
  try {
    now = storeNowWallClock(input.storeTimeZone);
  } catch {
    now = storeNowWallClock("Asia/Tokyo");
  }
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

  function seatRowForReservationId(sid: string): Record<string, unknown> | undefined {
    const direct = seatById.get(sid);
    if (direct) return direct;
    const want = displayTableCode(sid);
    for (const [id, seat] of seatById) {
      if (id === sid || displayTableCode(id) === want) return seat;
    }
    return undefined;
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
          try {
            const base = startOfWallCalendarDayUtc(date, input.storeTimeZone).getTime();
            const resMs = base + (hr * 60 + min) * 60 * 1000;
            const diffHours = (resMs - now.nowMs) / (1000 * 60 * 60);
            if (diffHours < 2.5 && diffHours > -2) blockSeat = true;
            else if (diffHours >= 2.5) hasFuture = true;
          } catch {
            blockSeat = true;
          }
        }
      }

    for (const sidRaw of seatsArr) {
      const sid = typeof sidRaw === "string" ? sidRaw : "";
      if (!sid) continue;
      const seat = seatRowForReservationId(sid);
      if (!seat) continue;
      if (hasFuture) seat.hasFutureRes = true;
      if (blockSeat) {
        const st = normalizeReceptionSeatStatus(seat.status);
        if (st === "empty") seat.status = "reserved";
      }
    }
  }
  return seats;
}

function guestSeatTypePriorityList(c: Record<string, unknown>): string[] {
  const raw = c.receptionGuestSeatTypePriority;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeSeatTypeLabel(x)).filter(Boolean);
}

function assignmentTypePriorityScore(
  ids: string[],
  byCode: Map<string, { seatType: string }>,
  priorityList: string[],
): number {
  let s = 0;
  for (const id of ids) {
    const st = normalizeSeatTypeLabel(byCode.get(id)?.seatType);
    let idx = -1;
    for (let i = 0; i < priorityList.length; i++) {
      if (priorityList[i] === st) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) s += idx;
    else if (!st) s += 10000;
    else s += 5000;
  }
  return s;
}

/** 受付・一括編集の席表記（T22, store-c01 等）を卓マスタ publicCode に揃える */
function resolveReservationSeatIds(tables: { publicCode: string }[], inputs: string[]): string[] {
  const labelToCode = new Map<string, string>();
  for (const t of tables) {
    const pc = String(t.publicCode ?? "").trim();
    if (!pc) continue;
    const label = displayTableCode(pc);
    const prev = labelToCode.get(label);
    if (!prev || pc.length > prev.length) labelToCode.set(label, pc);
    labelToCode.set(pc, pc);
    labelToCode.set(pc.toLowerCase(), pc);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of inputs) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    let resolved = labelToCode.get(t) || labelToCode.get(t.toLowerCase());
    if (!resolved) {
      const label = displayTableCode(t);
      resolved = labelToCode.get(label) || t;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function pickReservationSeats(input: {
  storeId?: string;
  tables: { code: string; capacity: number; mergeWith: string[]; seatType?: string }[];
  used: Set<string>;
  num: number;
  maxMergeSize?: number;
  allOrNothingGroups?: string[][];
  /** receptionGuestSeatTypePriority（ネット予約の自動割当・空き判定） */
  seatTypePriority?: string[];
  /**
   * ネット予約の自動席割りでは、mergeAllOrNothingGroups が mergeWith 上つながらない卓を1グループに含むと
   * 連結条件と両立せず席が選べないことがある（例: 掘りごたつ島を1グループ化）。手動受付は reception-front 側。
   */
  skipAllOrNothingGroups?: boolean;
}): string[] | null {
  const { tables, used, num } = input;
  if (input.storeId === HARUNOYUKOTO_STORE_ID) {
    const picked = pickHarunoyukotoSeats(num, tables, used);
    if (picked) return picked;
  }
  const maxMergeSize = Math.max(1, Number.isFinite(Number(input.maxMergeSize)) ? Math.floor(Number(input.maxMergeSize)) : 10);
  const allOrNothingGroups = Array.isArray(input.allOrNothingGroups) ? input.allOrNothingGroups : [];
  const skipAon = input.skipAllOrNothingGroups === true;
  const seatTypePriority = Array.isArray(input.seatTypePriority)
    ? input.seatTypePriority.map((x) => normalizeSeatTypeLabel(x)).filter(Boolean)
    : [];

  const byCode = new Map<string, { code: string; capacity: number; mergeWith: string[]; seatType: string }>();
  for (const t of tables) {
    byCode.set(t.code, {
      ...t,
      seatType: normalizeSeatTypeLabel(t.seatType),
    });
  }

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

  const groups: { set: Set<string>; arr: string[] }[] = [];
  if (!skipAon) {
    for (const g of allOrNothingGroups) {
      if (!Array.isArray(g) || !g.every((x) => typeof x === "string")) continue;
      const arrAll = g.map(String).filter((x) => freeSet.has(x));
      if (arrAll.length < 2) continue;
      const sub = new Set(arrAll);
      const seen = new Set<string>();
      for (const start of arrAll) {
        if (seen.has(start)) continue;
        const comp: string[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
          const cur = stack.pop()!;
          comp.push(cur);
          for (const nx of adj.get(cur) || []) {
            if (!sub.has(nx) || seen.has(nx)) continue;
            seen.add(nx);
            stack.push(nx);
          }
        }
        comp.sort();
        if (comp.length < 2) continue;
        if (comp.length > maxMergeSize) continue;
        groups.push({ arr: comp, set: new Set(comp) });
      }
    }
  }

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
            let better = false;
            if (!bestIds) {
              better = true;
            } else if (cap < bestCap) {
              better = true;
            } else if (cap === bestCap && seatTypePriority.length) {
              const sc = assignmentTypePriorityScore(ids, byCode, seatTypePriority);
              const sb = assignmentTypePriorityScore(bestIds, byCode, seatTypePriority);
              if (sc < sb) better = true;
              else if (sc === sb && ids.length < bestLen) better = true;
              else if (sc === sb && ids.length === bestLen && key.localeCompare(bestKey) < 0) better = true;
            } else if (cap === bestCap && ids.length < bestLen) {
              better = true;
            } else if (cap === bestCap && ids.length === bestLen && key.localeCompare(bestKey) < 0) {
              better = true;
            }
            if (better) {
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

  // シフト JSON の「予約済み reserved」は手動予約ロックと二重になりやすく、かつ GET /state の表示用ブロックと
  // DB 上の raw seats がずれるとネットだけ全枠満席になる。カレンダー上の埋まりは receptionReservationSeat に任せ、
  // ここでは物理的に案内できない席だけシフトから拾う。
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
    if (isSeatBlockedForBooking(st)) used.add(id);
  }
  return used;
}

function netReserveSlotStepMinutes(c: Record<string, unknown>): number {
  const n = Number(c.netReserveSlotMinutes);
  if (!Number.isFinite(n)) return 15;
  return Math.max(5, Math.min(60, Math.floor(n)));
}

/** ネット予約: 席種別をお客に選ばせるか。既定は全席から空き判定（種別なし）。 */
function netReserveSeatTypeMode(c: Record<string, unknown>): "any" | "require_select" {
  return c.netReserveSeatTypeMode === "require_select" ? "require_select" : "any";
}

/** 卓マスタの種別とクエリを同一視（全角半角・結合文字・余分な空白の差で卓0件→全枠満席にならないように） */
function normalizeSeatTypeLabel(s: unknown): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC");
}

/** 店舗プレフィックス付き卓コード（区切りは - または _）。受付・ネット予約の席一覧に使用 */
const rxNetBookableTableCode = /^(?:[A-Za-z0-9_-]+[-_])?(C\d+|T\d+|\d+)$/i;

/** 有効卓の seatType から種別一覧（正規表現と無関係。受付端末のボタン・ネット予約の種別 UI 用） */
async function listAllDistinctTableSeatTypes(storeId: string): Promise<string[]> {
  const rows = await prisma.table.findMany({
    where: { storeId, active: true },
    select: { seatType: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    const st = normalizeSeatTypeLabel(r.seatType);
    if (st) set.add(st);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ja"));
}

async function distinctSeatTypesForNetReserve(storeId: string): Promise<string[]> {
  const rows = await prisma.table.findMany({
    where: { storeId, active: true },
    select: { publicCode: true, seatType: true },
  });
  const set = new Set<string>();
  for (const r of netReserveBookableTableRows(rows)) {
    const st = normalizeSeatTypeLabel(r.seatType);
    if (st) set.add(st);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ja"));
}

/** ネット予約の卓候補: 従来の C/T 形式または席種別が設定されている卓 */
function isNetReserveTableRow(t: { publicCode: string; seatType?: string | null }): boolean {
  const pc = String(t.publicCode ?? "").trim();
  if (!pc) return false;
  const st = normalizeSeatTypeLabel(t.seatType);
  return rxNetBookableTableCode.test(pc) || Boolean(st);
}

/** カウンター卓（C01 形式・legacy 1–10 番・seatType=カウンター）。ネット予約の自動割当対象外 */
function isCounterTableRow(t: { publicCode: string; seatType?: string | null }): boolean {
  if (normalizeSeatTypeLabel(t.seatType) === "カウンター") return true;
  const pc = String(t.publicCode ?? "").trim();
  if (!pc) return false;
  if (/^(?:[A-Za-z0-9_-]+[-_])?C\d+$/i.test(pc)) return true;
  if (/^\d+$/.test(pc)) {
    const n = parseInt(pc, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return true;
  }
  return false;
}

function netReserveBookableTableRows<T extends { publicCode: string; seatType?: string | null }>(
  tables: T[],
): T[] {
  return tables.filter((t) => isNetReserveTableRow(t) && !isCounterTableRow(t));
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

type ReservationSeatDb = Pick<typeof prisma, "receptionReservationSeat">;

function reservationSeatShiftKeys(
  resKey: string,
  date: string,
  shift: string,
  timeRaw?: string,
): string[] {
  const time = typeof timeRaw === "string" ? timeRaw.trim() : "";
  const legacyKey = legacyDaypartShiftKey(date, shift === "dinner" ? "dinner" : "lunch");
  const isNet = resKey.startsWith("N");
  const slotKey = isNet && time ? netReserveSlotKey(date, time) : null;
  return slotKey ? [slotKey, legacyKey] : [legacyKey];
}

async function assertReservationSeatsFree(
  db: ReservationSeatDb,
  input: {
    storeId: string;
    resKey: string;
    shiftKeys: string[];
    seatIds: string[];
    excludeResKeys?: string[];
  },
): Promise<string | null> {
  const shiftKeys = [...new Set(input.shiftKeys.filter(Boolean))];
  const seatIds = [...new Set(input.seatIds.filter(Boolean))];
  if (!shiftKeys.length || !seatIds.length) return null;
  const exclude = [...new Set([input.resKey, ...(input.excludeResKeys ?? [])].filter(Boolean))];
  const conflict = await db.receptionReservationSeat.findFirst({
    where: {
      storeId: input.storeId,
      shiftKey: { in: shiftKeys },
      seatId: { in: seatIds },
      resKey: { notIn: exclude },
    },
    select: { seatId: true, resKey: true },
  });
  if (!conflict) return null;
  return `席 ${displayTableCode(conflict.seatId)} は別の予約（${conflict.resKey}）で使用中です`;
}

function assertBulkReservationSeatAssignments(
  rows: {
    resId: string;
    date: string;
    shift: string;
    time: string;
    status: string | null;
    seats: string[];
  }[],
): string | null {
  const slotOwner = new Map<string, string>();
  for (const row of rows) {
    if (row.status === "キャンセル") continue;
    const shiftKeys = reservationSeatShiftKeys(row.resId, row.date, row.shift, row.time);
    for (const seatId of row.seats) {
      for (const sk of shiftKeys) {
        const key = `${sk}\0${seatId}`;
        const prev = slotOwner.get(key);
        if (prev && prev !== row.resId) {
          return `一括保存内で席 ${displayTableCode(seatId)} が重複しています（${prev} と ${row.resId}）`;
        }
        slotOwner.set(key, row.resId);
      }
    }
  }
  return null;
}

async function writeReservationSeatLocks(
  db: ReservationSeatDb,
  input: {
    storeId: string;
    resKey: string;
    date: string;
    shift: string;
    time?: string;
    seats: string[];
  },
): Promise<void> {
  const { storeId, resKey, date, shift, seats } = input;
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const uniqueSeats = [...new Set(seats.filter((s) => typeof s === "string" && s))];
  if (uniqueSeats.length === 0) return;

  const legacyKey = legacyDaypartShiftKey(date, shift === "dinner" ? "dinner" : "lunch");
  const isNet = resKey.startsWith("N");
  const slotKey = isNet && time ? netReserveSlotKey(date, time) : null;

  if (slotKey) {
    const rows: { storeId: string; shiftKey: string; seatId: string; resKey: string }[] = [];
    for (const seatId of uniqueSeats) {
      rows.push({ storeId, shiftKey: slotKey, seatId, resKey });
      rows.push({ storeId, shiftKey: legacyKey, seatId, resKey });
    }
    await db.receptionReservationSeat.createMany({ data: rows });
    return;
  }

  await db.receptionReservationSeat.createMany({
    data: uniqueSeats.map((seatId) => ({ storeId, resKey, shiftKey: legacyKey, seatId })),
  });
}

async function syncReservationSeatLocks(input: {
  storeId: string;
  resKey: string;
  date: string;
  shift: string;
  time?: string;
  seats: string[];
  status: string | null | undefined;
  excludeResKeysFromConflict?: string[];
  skipDelete?: boolean;
  db?: ReservationSeatDb;
}): Promise<void> {
  const db = input.db ?? prisma;
  const { storeId, resKey, date, shift, seats, status } = input;
  const time = typeof input.time === "string" ? input.time.trim() : "";
  if (!input.skipDelete) {
    await db.receptionReservationSeat.deleteMany({ where: { storeId, resKey } });
  }
  if (status === "キャンセル") return;
  const uniqueSeats = [...new Set(seats.filter((s) => typeof s === "string" && s))];
  if (uniqueSeats.length === 0) return;

  const shiftKeys = reservationSeatShiftKeys(resKey, date, shift, time);
  const conflictMsg = await assertReservationSeatsFree(db, {
    storeId,
    resKey,
    shiftKeys,
    seatIds: uniqueSeats,
    excludeResKeys: input.excludeResKeysFromConflict,
  });
  if (conflictMsg) throw new Error(conflictMsg);

  await writeReservationSeatLocks(db, { storeId, resKey, date, shift, time, seats: uniqueSeats });
}

/** ネット予約: 時刻枠キーに加え、昼/夜シフト（date_lunch / date_dinner）でもロック（同一シフト内の別時刻の二重割当防止） */
async function createNetReservationSeatLocks(
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    resKey: string;
    slotKey: string;
    legacyShiftKey: string;
    seatIds: string[];
  },
): Promise<void> {
  const uniqueSeats = [...new Set(input.seatIds.filter((s) => typeof s === "string" && s))];
  if (uniqueSeats.length === 0) return;
  const rows: { storeId: string; shiftKey: string; seatId: string; resKey: string }[] = [];
  for (const seatId of uniqueSeats) {
    rows.push({
      storeId: input.storeId,
      shiftKey: input.slotKey,
      seatId,
      resKey: input.resKey,
    });
    rows.push({
      storeId: input.storeId,
      shiftKey: input.legacyShiftKey,
      seatId,
      resKey: input.resKey,
    });
  }
  await tx.receptionReservationSeat.createMany({ data: rows });
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
  try {
    await prisma.receptionShift.create({
      data: { storeId, shiftKey, seats: [], waiting: [] },
    });
  } catch (e: unknown) {
    // findUnique 直後に別リクエストが同じ shift を作成した場合のユニーク衝突
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
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
  const merged = await prisma.diningSession.findFirst({
    where: { storeId, tableId: table.id, status: "merged" },
    select: { id: true },
  });

  if (next === "guiding") {
    return;
  }
  if (next === "occupied") {
    const nextCount = Math.max(1, Number.isFinite(current) ? Math.floor(current) : 1);
    // If bashing_waiting exists, reuse it (avoid creating 2 sessions per table)
    if (!open && bash) {
      await prisma.diningSession.update({ where: { id: bash.id }, data: { status: "open", guestCount: nextCount, closedAt: null } });
      return;
    }
    // 合算で merged の卓は open-table-session が拒否するため、受付からの新規オープンも試みない
    if (!open && merged) {
      return;
    }
    if (!open) {
      // 受付マップを「利用中」（青）にしただけではオーダー用セッションは作らない（卓QR・オペ・ハンディ等で開始）
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
  // empty/vacant によるセッション切断は cleaning→empty の明示操作のみ（updateSeats 内）で行う
}

function collectWalkInUsedFromSeatRows(seats: unknown[], requirePure: boolean): Set<string> {
  const used = new Set<string>();
  for (const raw of seats) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    if (!id) continue;
    const st = normalizeReceptionSeatStatus(s.status);
    if (st !== "empty" && st !== "reserved") used.add(id);
    if (requirePure && s.hasFutureRes === true) used.add(id);
  }
  return used;
}

export async function registerReception(app: FastifyInstance): Promise<void> {
  /** 受付端末用: DB の席種別だけ返す（軽量・304 なし） */
  app.get<{ Params: { storeId: string } }>("/reception/:storeId/table-seat-types", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const seatTypes = await listAllDistinctTableSeatTypes(store.id);
    reply.header("Cache-Control", "no-store");
    return { seatTypes };
  });

  /** ゲスト受付端末: 人数・席種別から案内席を提案（はるのゆことは店舗専用優先順） */
  app.post<{
    Params: { storeId: string };
    Body: { num?: number; seatPreference?: string; shiftKey?: string; requirePure?: boolean };
  }>("/reception/:storeId/suggest-walk-in-seats", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);

    const num = Math.floor(Number(req.body?.num));
    if (!Number.isFinite(num) || num < 1 || num > 20) {
      return reply.code(400).send({ error: "num must be 1..20" });
    }
    const seatPreference =
      typeof req.body?.seatPreference === "string" && req.body.seatPreference.trim()
        ? req.body.seatPreference.trim()
        : "any";
    const requirePure = req.body?.requirePure === true;

    const stSet = mergeStoreSettings(store.settings);
    const confRow = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const cData = (confRow?.data as Record<string, unknown>) || {};
    const lunchEnd = receptionLunchEndHour(cData);
    const shiftKey =
      (typeof req.body?.shiftKey === "string" ? req.body.shiftKey.trim() : "") ||
      buildTodayShiftKey(stSet.timezone, lunchEnd);
    const isLiveShift = isCurrentReceptionShiftKey(shiftKey, stSet.timezone, lunchEnd);

    await ensureShift(store.id, shiftKey);

    const [sh, reservations, derivedLive, allTables] = await Promise.all([
      prisma.receptionShift.findUnique({
        where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
      }),
      prisma.receptionReservation.findMany({ where: { storeId: store.id } }),
      computeDefaultSeatsForShift(store.id),
      prisma.table.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: "asc" },
        select: { publicCode: true, capacity: true, mergeWith: true, seatType: true },
      }),
    ]);

    let seats = Array.isArray(sh?.seats) ? (sh?.seats as unknown[]) : [];
    if (!seats.length) {
      seats = (isLiveShift ? derivedLive : emptyDerivedSeatRows(derivedLive)) as unknown[];
    } else if (isLiveShift) {
      seats = mergeShiftSeatsWithLiveDerived(seats, derivedLive) as unknown[];
    } else {
      seats = stripLiveSessionStatesFromFutureShiftSeats(seats, shiftKey, stSet.timezone);
    }

    let seatsWithBlocks = applyReservationBlocksToSeats({
      shiftKey,
      seats,
      reservations: reservations.map((r) => r.data) as unknown[],
      storeTimeZone: stSet.timezone,
    });
    const legacyClear = clearLegacyStaffCountBlocks(seatsWithBlocks);
    seatsWithBlocks = legacyClear.seats;

    const used = collectWalkInUsedFromSeatRows(seatsWithBlocks, requirePure);

    const prefNorm =
      seatPreference === "any" ? "any" : normalizeSeatTypeLabel(seatPreference);
    const bookable = netReserveBookableTableRows(allTables);
    const filtered =
      prefNorm === "any"
        ? bookable
        : bookable.filter((t) => normalizeSeatTypeLabel(t.seatType) === prefNorm);

    const tableMaster = filtered.map((t) => ({
      code: t.publicCode,
      capacity: Number(t.capacity || 2),
      mergeWith: Array.isArray(t.mergeWith)
        ? (t.mergeWith.filter((x) => typeof x === "string") as string[])
        : [],
      seatType: normalizeSeatTypeLabel(t.seatType),
    }));

    const maxMergeSize = Number.isFinite(Number(cData.maxMergeSize)) ? Number(cData.maxMergeSize) : 10;
    const allOrNothingGroups = Array.isArray(cData.mergeAllOrNothingGroups)
      ? cData.mergeAllOrNothingGroups
      : [];
    const seatTypePriority =
      prefNorm === "any" ? guestSeatTypePriorityList(cData) : [];

    const seatIds = pickReservationSeats({
      storeId: store.id,
      tables: tableMaster,
      used,
      num,
      maxMergeSize,
      allOrNothingGroups,
      skipAllOrNothingGroups: true,
      seatTypePriority,
    });

    return { seatIds: seatIds ?? [] };
  });

  /**
   * 旧 api.php 互換の read API
   * - shiftKey が無ければ「今日の lunch/dinner」を使う
   */
  app.get<{ Params: { storeId: string }; Querystring: { shiftKey?: string; skip304?: string } }>(
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
      const isLiveShift = isCurrentReceptionShiftKey(shiftKey, stSet.timezone, lunchEnd);

      await ensureShift(store.id, shiftKey);

      const [conf, st, sh, reservations, derivedLive, allTables, seatTypeOptions] = await Promise.all([
        prisma.receptionConfig.findUnique({ where: { storeId: store.id } }),
        prisma.receptionState.findUnique({ where: { storeId: store.id } }),
        prisma.receptionShift.findUnique({ where: { storeId_shiftKey: { storeId: store.id, shiftKey } } }),
        prisma.receptionReservation.findMany({ where: { storeId: store.id } }),
        computeDefaultSeatsForShift(store.id),
        prisma.table.findMany({
          where: { storeId: store.id, active: true },
          orderBy: { sortOrder: "asc" },
          select: { publicCode: true, capacity: true, mergeWith: true, name: true, seatType: true },
        }),
        listAllDistinctTableSeatTypes(store.id),
      ]);

      // 旧 index.html の Etag キャッシュ互換（内容が変わらなければ 304）
      // ※ DiningSession だけ変わった場合も再取得できるようライブ席スナップショットを含める
      const maxResUpdatedAt = reservations.reduce((acc, r) => Math.max(acc, r.updatedAt?.getTime?.() ?? 0), 0);
      const liveSeatSig = isLiveShift
        ? derivedLive
            .map((s) => `${s.id}:${s.status}:${s.current}:${s.seatType}`)
            .sort()
            .join(",")
        : "";
      const tableMasterSig = allTables
        .map((t) => `${t.publicCode}:${String(t.seatType ?? "").trim()}`)
        .sort()
        .join("|");
      const etag = receptionStateWeakEtag([
        conf?.updatedAt?.getTime?.() ?? 0,
        st?.updatedAt?.getTime?.() ?? 0,
        sh?.updatedAt?.getTime?.() ?? 0,
        maxResUpdatedAt,
        liveSeatSig,
        tableMasterSig,
      ]);
      const inm = (req.headers["if-none-match"] || "").toString();
      const skip304 = String(req.query.skip304 || "") === "1";
      reply.header("Etag", etag);
      if (!skip304 && inm === etag) return reply.code(304).send();

      // seats が空なら卓マスタから初期化。ライブセッションは「いまの営業シフト」のみ反映
      let seats = Array.isArray((sh?.seats as unknown) as unknown[]) ? (sh?.seats as unknown[]) : [];
      let waiting = Array.isArray((sh?.waiting as unknown) as unknown[]) ? (sh?.waiting as unknown[]) : [];
      if (!seats || seats.length === 0) {
        const initial = isLiveShift ? derivedLive : emptyDerivedSeatRows(derivedLive);
        seats = initial as unknown[];
        await prisma.receptionShift.update({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
          data: { seats: initial as never },
        });
      } else if (isLiveShift) {
        seats = mergeShiftSeatsWithLiveDerived(seats, derivedLive) as unknown[];
      } else {
        seats = stripLiveSessionStatesFromFutureShiftSeats(seats, shiftKey, stSet.timezone);
      }

      let seatsWithBlocks = applyReservationBlocksToSeats({
        shiftKey,
        seats: seats as unknown[],
        reservations: reservations.map((r) => r.data) as unknown[],
        storeTimeZone: stSet.timezone,
      });
      const legacyClear = clearLegacyStaffCountBlocks(seatsWithBlocks);
      seatsWithBlocks = legacyClear.seats;
      if (legacyClear.changed) {
        await prisma.receptionShift.update({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
          data: { seats: seatsWithBlocks as never },
        });
      }

      const fallbackMaster = seatsWithBlocks
        .map((x) => {
          if (!x || typeof x !== "object" || Array.isArray(x)) return null;
          const o = x as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id : "";
          if (!id) return null;
          const capRaw = o.capacity;
          const cap =
            typeof capRaw === "number" && Number.isFinite(capRaw)
              ? Math.max(1, Math.floor(capRaw))
              : 2;
          const mergeRaw = o.mergeWith;
          const mergeWith = Array.isArray(mergeRaw)
            ? (mergeRaw.filter((z) => typeof z === "string") as string[])
            : [];
          const seatType = String(o.seatType ?? "").trim();
          return { code: id, name: id, capacity: cap, mergeWith, seatType };
        })
        .filter((row): row is { code: string; name: string; capacity: number; mergeWith: string[]; seatType: string } => row !== null);

      const liveShiftKey = buildTodayShiftKey(stSet.timezone, lunchEnd);

      return {
        config: conf ? conf.data : { override: false, manualWait: 30 },
        isLiveShift,
        liveShiftKey,
        callReserved: Boolean(st?.callReserved),
        callType: st?.callType ?? "",
        entryQueue: (st?.entryQueue ?? []) as unknown,
        seatTypeOptions,
        tableMaster: (() => {
          const masterRows = allTables.filter((t) => String(t.publicCode ?? "").trim() !== "");
          if (masterRows.length === 0) return fallbackMaster;
          return masterRows.map((t) => ({
            code: t.publicCode,
            name: t.name,
            capacity: Math.max(1, Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : 2),
            mergeWith: Array.isArray(t.mergeWith) ? (t.mergeWith as unknown[]).filter((x) => typeof x === "string") : [],
            seatType: String(t.seatType ?? "").trim(),
          }));
        })(),
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
        delete next.staff;
        await prisma.receptionConfig.update({
          where: { storeId: store.id },
          data: { data: next as never },
        });
        const todayKey = buildTodayShiftKey(stSetEv.timezone, lunchEndEv);
        await ensureShift(store.id, todayKey);
        const shToday = await prisma.receptionShift.findUnique({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey: todayKey } },
          select: { seats: true },
        });
        let todaySeats = Array.isArray((shToday?.seats as unknown) as unknown[])
          ? ((shToday?.seats as unknown[]) ?? [])
          : [];
        if (!todaySeats.length) {
          todaySeats = (await computeDefaultSeatsForShift(store.id)) as unknown[];
        }
        const legacyClear = clearLegacyStaffCountBlocks(todaySeats);
        if (legacyClear.changed) {
          await prisma.receptionShift.update({
            where: { storeId_shiftKey: { storeId: store.id, shiftKey: todayKey } },
            data: { seats: legacyClear.seats as never },
          });
        }
        return receptionMutationNotify(store.id);
      }
      if (type === "callReserved") {
        const callType = typeof b.callType === "string" ? b.callType : "normal";
        await prisma.receptionState.update({
          where: { storeId: store.id },
          data: { callReserved: true, callType },
        });
        return receptionMutationNotify(store.id);
      }
      if (type === "resetCall") {
        await prisma.receptionState.update({
          where: { storeId: store.id },
          data: { callReserved: false, callType: "" },
        });
        return receptionMutationNotify(store.id);
      }
      if (type === "popEntry") {
        const st = await prisma.receptionState.findUnique({ where: { storeId: store.id } });
        const q = Array.isArray((st?.entryQueue as unknown) as unknown[]) ? ((st?.entryQueue as unknown[]) ?? []) : [];
        q.shift();
        await prisma.receptionState.update({ where: { storeId: store.id }, data: { entryQueue: q as never } });
        return receptionMutationNotify(store.id);
      }
      if (type === "addReservation") {
        const res = (b.reservation && typeof b.reservation === "object" && !Array.isArray(b.reservation)
          ? b.reservation
          : null) as Record<string, unknown> | null;
        const resId = res && typeof res.resId === "string" ? res.resId : "";
        const date = res && typeof res.date === "string" ? res.date : "";
        const shift = res && typeof res.shift === "string" ? res.shift : "";
        const time = res && typeof res.time === "string" ? res.time : "";
        const status = res && typeof res.status === "string" ? res.status : null;
        if (!resId || !date || !shift) return reply.code(400).send({ error: "reservation needs resId/date/shift" });
        const tableRows = await prisma.table.findMany({
          where: { storeId: store.id, active: true },
          select: { publicCode: true },
        });
        const rawSeats = Array.isArray(res?.seats)
          ? (res.seats as unknown[]).filter((x) => typeof x === "string") as string[]
          : [];
        const seats = resolveReservationSeatIds(tableRows, rawSeats);
        const nextRes = { ...res, seats };
        const prevRow = await prisma.receptionReservation.findUnique({
          where: { storeId_resKey: { storeId: store.id, resKey: resId } },
        });
        const prevStatus = netReserveReservationPrevStatus(prevRow);
        try {
          await prisma.receptionReservation.upsert({
            where: { storeId_resKey: { storeId: store.id, resKey: resId } },
            create: { storeId: store.id, resKey: resId, data: nextRes as never, date, shift, status },
            update: { data: nextRes as never, date, shift, status },
          });
          await syncReservationSeatLocks({
            storeId: store.id,
            resKey: resId,
            date,
            shift,
            time,
            seats,
            status,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.code(409).send({ error: msg || "seat lock failed" });
        }
        const origin = staffRequestOrigin(req);
        const receptionUrl = `${origin}/staff-app/${encodeURIComponent(store.id)}/reception`;
        await maybeNotifyNetReserveCancelled(
          store,
          resId,
          prevStatus,
          nextRes,
          status,
          receptionUrl,
          req.log,
        );
        return receptionMutationNotify(store.id);
      }
      if (type === "deleteReservation") {
        const resId = typeof b.resId === "string" ? b.resId.trim() : "";
        if (!resId) return reply.code(400).send({ error: "resId required" });
        await prisma.receptionReservationSeat.deleteMany({ where: { storeId: store.id, resKey: resId } });
        await prisma.receptionReservation.deleteMany({ where: { storeId: store.id, resKey: resId } });
        return receptionMutationNotify(store.id);
      }
      if (type === "bulkUpdateReservations") {
        const arr = Array.isArray(b.reservations) ? (b.reservations as unknown[]) : [];
        const tableRows = await prisma.table.findMany({
          where: { storeId: store.id, active: true },
          select: { publicCode: true },
        });
        const bulkOrigin = staffRequestOrigin(req);
        const bulkReceptionUrl = `${bulkOrigin}/staff-app/${encodeURIComponent(store.id)}/reception`;

        type BulkPrepared = {
          resId: string;
          date: string;
          shift: string;
          time: string;
          status: string | null;
          seats: string[];
          data: Record<string, unknown>;
          prevRow: Awaited<ReturnType<typeof prisma.receptionReservation.findUnique>>;
        };
        const prepared: BulkPrepared[] = [];
        for (const row of arr) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const r = row as Record<string, unknown>;
          const resId = typeof r.resId === "string" ? r.resId.trim() : "";
          const date = typeof r.date === "string" ? r.date.trim() : "";
          const shift = typeof r.shift === "string" ? r.shift.trim() : "";
          const time = typeof r.time === "string" ? r.time.trim() : "";
          const status = typeof r.status === "string" ? r.status : null;
          if (!resId || !date || !shift) continue;
          const rawSeats = Array.isArray(r.seats)
            ? (r.seats as unknown[]).filter((x) => typeof x === "string") as string[]
            : [];
          const seats = resolveReservationSeatIds(tableRows, rawSeats);
          r.seats = seats;
          const prevRow = await prisma.receptionReservation.findUnique({
            where: { storeId_resKey: { storeId: store.id, resKey: resId } },
          });
          prepared.push({ resId, date, shift, time, status, seats, data: r, prevRow });
        }

        if (prepared.length === 0) {
          return reply.code(400).send({ error: "reservations required" });
        }

        const batchResKeys = prepared.map((p) => p.resId);
        const batchConflict = assertBulkReservationSeatAssignments(prepared);
        if (batchConflict) {
          return reply.code(409).send({ error: batchConflict });
        }

        try {
          await prisma.$transaction(async (tx) => {
            await tx.receptionReservationSeat.deleteMany({
              where: { storeId: store.id, resKey: { in: batchResKeys } },
            });
            for (const row of prepared) {
              if (row.status === "キャンセル" || row.seats.length === 0) continue;
              const shiftKeys = reservationSeatShiftKeys(row.resId, row.date, row.shift, row.time);
              const conflictMsg = await assertReservationSeatsFree(tx, {
                storeId: store.id,
                resKey: row.resId,
                shiftKeys,
                seatIds: row.seats,
                excludeResKeys: batchResKeys,
              });
              if (conflictMsg) throw new Error(conflictMsg);
            }
            for (const row of prepared) {
              await tx.receptionReservation.upsert({
                where: { storeId_resKey: { storeId: store.id, resKey: row.resId } },
                create: {
                  storeId: store.id,
                  resKey: row.resId,
                  data: row.data as never,
                  date: row.date,
                  shift: row.shift,
                  status: row.status,
                },
                update: { data: row.data as never, date: row.date, shift: row.shift, status: row.status },
              });
              await syncReservationSeatLocks({
                storeId: store.id,
                resKey: row.resId,
                date: row.date,
                shift: row.shift,
                time: row.time,
                seats: row.seats,
                status: row.status,
                skipDelete: true,
                excludeResKeysFromConflict: batchResKeys,
                db: tx,
              });
            }
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return reply.code(409).send({ error: msg || "seat lock failed" });
        }

        for (const row of prepared) {
          await maybeNotifyNetReserveCancelled(
            store,
            row.resId,
            netReserveReservationPrevStatus(row.prevRow),
            row.data,
            row.status,
            bulkReceptionUrl,
            req.log,
          );
        }
        return receptionMutationNotify(store.id);
      }

      if (type === "updateAll" || type === "updateSeats") {
        // 旧 api.php / index.html 互換: updateSeats は payload に seats が入る
        let seats = Array.isArray(b.seats) ? (b.seats as unknown[]) : (Array.isArray(b.payload) ? (b.payload as unknown[]) : null);
        const waiting = Array.isArray(b.waiting) ? (b.waiting as unknown[]) : null;
        const isLiveShift = isCurrentReceptionShiftKey(shiftKey, stSetEv.timezone, lunchEndEv);
        const ifShiftUpdatedAt = typeof b.ifShiftUpdatedAt === "number" ? b.ifShiftUpdatedAt : null;
        const prevShift = await prisma.receptionShift.findUnique({
          where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
          select: { seats: true, updatedAt: true },
        });
        if (ifShiftUpdatedAt !== null) {
          const curMs = prevShift?.updatedAt ? prevShift.updatedAt.getTime() : 0;
          if (curMs && curMs !== ifShiftUpdatedAt) {
            return reply.code(409).send({ error: "STALE_SHIFT", currentUpdatedAt: curMs });
          }
        }
        const prevById = new Map<string, ReceptionSeatStatus>();
        const prevArr = Array.isArray((prevShift?.seats as unknown) as unknown[])
          ? ((prevShift?.seats as unknown[]) ?? [])
          : [];
        for (const row of prevArr) {
          if (!row || typeof row !== "object" || Array.isArray(row)) continue;
          const o = row as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id : "";
          if (!id) continue;
          prevById.set(id, normalizeReceptionSeatStatus(o.status));
        }
        if (seats && seats.length > 0) {
          const legacyClear = clearLegacyStaffCountBlocks(seats);
          seats = legacyClear.seats;
          for (const row of seats) {
            if (!row || typeof row !== "object" || Array.isArray(row)) continue;
            const r = row as Record<string, unknown>;
            const id = typeof r.id === "string" ? r.id : "";
            if (!id) continue;
            const prev = prevById.get(id) ?? "empty";
            const next = normalizeReceptionSeatStatus(r.status);
            if (isForbiddenManualReceptionSeatTransition(prev, next)) {
              return reply.code(400).send({
                error: "OCCUPIED_TO_CLEANING_FORBIDDEN",
                message: "利用中（青）からバッシング（赤）へは、レジ会計またはセッション終了でのみ変更できます。",
                seatId: id,
              });
            }
            if (
              isLiveShift &&
              prev === "cleaning" &&
              (next === "empty" || next === "vacant")
            ) {
              await closeTableSessionsForReceptionMapClear(store.id, id);
              // スタッフがバッシング完了で空席に戻した操作は常に白（empty）。予約ブロックは GET /state の applyReservationBlocksToSeats で近い枠のみ反映。
              r.status = "empty";
            }
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

        // セッション同期は「いまの営業シフト」のみ（別日・別シフト閲覧時の updateSeats で全席セッション切断しない）
        if (isLiveShift) {
          const syncSeats = (seats ?? []) as unknown[];
          for (const row of syncSeats) {
            if (!row || typeof row !== "object" || Array.isArray(row)) continue;
            const r = row as Record<string, unknown>;
            const id = typeof r.id === "string" ? r.id : "";
            const st = typeof r.status === "string" ? r.status : "";
            const cur = typeof r.current === "number" ? r.current : 0;
            if (!id) continue;
            if (st === "occupied" || st === "cleaning" || st === "guiding") {
              await syncSeatToSessions(store.id, id, st as SeatStatus, cur);
            }
          }
        }

        return receptionMutationNotify(store.id);
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
    const seatTypeMode = netReserveSeatTypeMode(c as Record<string, unknown>);
    const seatTypes = await distinctSeatTypesForNetReserve(store.id);
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
      seatTypeMode,
      seatTypes,
    };
  });

  /**
   * ネット予約: 人数別の空き枠（公開）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { date?: string; partySize?: string; seatType?: string };
  }>("/reception/:storeId/net/availability", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);

    const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const c = (conf?.data as any) || {};
    const daysAhead = Number.isFinite(Number(c.netReserveDaysAhead)) ? Number(c.netReserveDaysAhead) : 30;
    const seatTypeMode = netReserveSeatTypeMode(c as Record<string, unknown>);
    const seatTypeQ = typeof req.query.seatType === "string" ? req.query.seatType.trim() : "";
    const seatTypeNorm = normalizeSeatTypeLabel(seatTypeQ);
    if (seatTypeMode === "require_select" && !seatTypeNorm) {
      return reply.code(400).send({ error: "seatType required" });
    }

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

    const maxMergeSize = Number.isFinite(Number(c.maxMergeSize)) ? Number(c.maxMergeSize) : 10;
    const allOrNothingGroups = Array.isArray(c.mergeAllOrNothingGroups) ? c.mergeAllOrNothingGroups : [];
    const n = Math.floor(partySize);
    const seatTypePriority =
      seatTypeMode === "require_select" ? [] : guestSeatTypePriorityList(c as Record<string, unknown>);
    const allowedTypes = await distinctSeatTypesForNetReserve(store.id);
    const allowedTypeSet = new Set(allowedTypes);
    if (seatTypeMode === "require_select" && seatTypeNorm === "カウンター") {
      return reply.code(400).send({ error: "counter seats not available for net reservation" });
    }
    if (seatTypeMode === "require_select" && seatTypeNorm && !allowedTypeSet.has(seatTypeNorm)) {
      return reply.code(400).send({ error: "invalid seatType" });
    }

    const slots = await prisma.$transaction(async (tx) => {
      const tables = await tx.table.findMany({
        where: { storeId: store.id, active: true },
        select: { publicCode: true, capacity: true, mergeWith: true, seatType: true },
        orderBy: { sortOrder: "asc" },
      });
      const bookable = netReserveBookableTableRows(tables);
      const filtered =
        seatTypeMode === "require_select"
          ? bookable.filter((t) => normalizeSeatTypeLabel(t.seatType) === seatTypeNorm)
          : bookable;
      const tableMaster = filtered.map((t) => ({
        code: t.publicCode,
        capacity: Number(t.capacity || 2),
        mergeWith: Array.isArray(t.mergeWith) ? t.mergeWith.filter((x) => typeof x === "string") as string[] : [],
        seatType: normalizeSeatTypeLabel(t.seatType),
      }));
      const out: { time: string; available: boolean }[] = [];
      for (const time of slotTimes) {
        const used = await collectUsedSeatsForNetReservation(tx, store.id, date, time, lunchH);
        const seats = pickReservationSeats({
          storeId: store.id,
          tables: tableMaster,
          used,
          num: n,
          maxMergeSize,
          allOrNothingGroups,
          skipAllOrNothingGroups: true,
          seatTypePriority,
        });
        out.push({ time, available: seats !== null });
      }
      return out;
    });

    return { date, partySize: n, timezone: stSet.timezone, slots, seatType: seatTypeNorm || null };
  });

  /**
   * ネット予約: 予約登録（公開）
   */
  app.post<{
    Params: { storeId: string };
    Body: {
      date?: unknown;
      time?: unknown;
      name?: unknown;
      num?: unknown;
      note?: unknown;
      seatType?: unknown;
      email?: unknown;
      phone?: unknown;
    };
  }>("/reception/:storeId/net/reservations", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    await ensureReceptionRows(store.id);

    const conf = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
    const c = (conf?.data as any) || {};
    const daysAhead = Number.isFinite(Number(c.netReserveDaysAhead)) ? Number(c.netReserveDaysAhead) : 30;
    const enableNote = c.netReserveEnableNote === undefined ? true : Boolean(c.netReserveEnableNote);
    const seatTypeMode = netReserveSeatTypeMode(c as Record<string, unknown>);
    const seatTypePriority =
      seatTypeMode === "require_select" ? [] : guestSeatTypePriorityList(c as Record<string, unknown>);
    const seatTypeBodyRaw = typeof req.body?.seatType === "string" ? req.body.seatType.trim() : "";
    const seatTypeBody = normalizeSeatTypeLabel(seatTypeBodyRaw);
    const allowedTypes = await distinctSeatTypesForNetReserve(store.id);
    const allowedTypeSet = new Set(allowedTypes);
    if (seatTypeMode === "require_select" && seatTypeBody === "カウンター") {
      return reply.code(400).send({ error: "counter seats not available for net reservation" });
    }
    if (seatTypeMode === "require_select") {
      if (!seatTypeBody) return reply.code(400).send({ error: "seatType required" });
      if (!allowedTypeSet.has(seatTypeBody)) return reply.code(400).send({ error: "invalid seatType" });
    } else if (seatTypeBody && !allowedTypeSet.has(seatTypeBody)) {
      return reply.code(400).send({ error: "invalid seatType" });
    }

    const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";
    const time = typeof req.body?.time === "string" ? req.body.time.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const num = typeof req.body?.num === "number" ? req.body.num : Number(req.body?.num);
    const noteRaw = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const note = enableNote ? noteRaw : "";
    const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const emailForMail =
      emailRaw.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: "invalid date" });
    const lunchHr = receptionLunchEndHour(c as Record<string, unknown>);
    const shift = shiftFromTimeHHMM(time, lunchHr);
    if (!shift) return reply.code(400).send({ error: "invalid time" });
    if (!name) return reply.code(400).send({ error: "name required" });
    const phoneNorm = normalizeReceptionPhone(req.body?.phone);
    if (!phoneNorm.ok) return reply.code(400).send({ error: "phone required" });
    if (!Number.isFinite(num) || num < 1 || num > 20) return reply.code(400).send({ error: "num must be 1..20" });

    const stSet = mergeStoreSettings(store.settings);
    if (isWallDateClosedByBusinessCalendar(stSet, date)) {
      return reply.code(403).send({ error: "この日は休業です。" });
    }
    if (!isReservationWallDateTimeAllowed(stSet, date, time)) {
      return reply.code(400).send({ error: "この日時は営業時間外です。" });
    }
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
            select: { publicCode: true, name: true, capacity: true, mergeWith: true, seatType: true },
            orderBy: { sortOrder: "asc" },
          });

          const used = await collectUsedSeatsForNetReservation(tx, store.id, date, time, lunchHr);

          const bookable = netReserveBookableTableRows(tables);
          const filtered =
            seatTypeMode === "require_select"
              ? bookable.filter((t) => normalizeSeatTypeLabel(t.seatType) === seatTypeBody)
              : bookable;
          const tableMaster = filtered.map((t) => ({
            code: t.publicCode,
            capacity: Number(t.capacity || 2),
            mergeWith: Array.isArray(t.mergeWith) ? t.mergeWith.filter((x) => typeof x === "string") as string[] : [],
            seatType: normalizeSeatTypeLabel(t.seatType),
          }));
          const maxMergeSize = Number.isFinite(Number(c.maxMergeSize)) ? Number(c.maxMergeSize) : 10;
          const allOrNothingGroups = Array.isArray(c.mergeAllOrNothingGroups) ? c.mergeAllOrNothingGroups : [];
          const seats = pickReservationSeats({
            storeId: store.id,
            tables: tableMaster,
            used,
            num: Math.floor(num),
            maxMergeSize,
            allOrNothingGroups,
            skipAllOrNothingGroups: true,
            seatTypePriority,
          });
          if (!seats) return { ok: false as const };

          const reservation = {
            resId,
            date,
            shift,
            time,
            name,
            phone: phoneNorm.phone,
            num: Math.floor(num),
            status: "予約確定",
            seats,
            note,
            ...(seatTypeMode === "require_select" && seatTypeBody ? { seatType: seatTypeBody } : {}),
            ...(emailForMail ? { email: emailForMail } : {}),
          };

          await tx.receptionReservation.upsert({
            where: { storeId_resKey: { storeId: store.id, resKey: resId } },
            create: { storeId: store.id, resKey: resId, data: reservation as never, date, shift, status: "予約確定" },
            update: { data: reservation as never, date, shift, status: "予約確定" },
          });
          await createNetReservationSeatLocks(tx, {
            storeId: store.id,
            resKey: resId,
            slotKey: slotKeySnap,
            legacyShiftKey: legacyKey,
            seatIds: seats,
          });
          const labelByCode = new Map(
            tables.map((t) => [t.publicCode, tableDisplayLabel(t.name, t.publicCode)]),
          );
          const seatLabels = seats.map((id) => labelByCode.get(id) || displayTableCode(id) || id);
          return { ok: true as const, resId, seats, seatLabels };
        });

        if (!out.ok) return reply.code(409).send({ error: "no available seats" });

        if (emailForMail) {
          const mailLines = [
            `${store.name} のネット予約が確定しました。`,
            "",
            `予約番号: ${out.resId}`,
            `日付: ${date}`,
            `時間: ${time}`,
            `お名前: ${name}`,
            `電話: ${phoneNorm.phone}`,
            `人数: ${Math.floor(num)}名`,
            ...(note ? [`備考: ${note}`] : []),
            ...(seatTypeMode === "require_select" && seatTypeBody ? [`席種別: ${seatTypeBody}`] : []),
            "",
            "※このメールは送信専用です。",
          ];
          void sendMailSafe(
            {
              to: emailForMail,
              subject: `【予約確定】${store.name} ${date} ${time}`,
              text: mailLines.join("\n"),
            },
            { storeSettings: stSet },
          ).catch((err: unknown) => req.log.warn({ err }, "net reserve confirmation mail failed"));
        }

        const staffNotifyTo = netReserveStaffNotifyEmails(c as Record<string, unknown>);
        if (staffNotifyTo.length > 0) {
          if (!isMailConfigured(stSet)) {
            req.log.warn(
              { storeId: store.id, recipients: staffNotifyTo.length },
              "net reserve staff notify skipped: SMTP not configured",
            );
          } else {
            const origin = staffRequestOrigin(req);
            const receptionUrl = `${origin}/staff-app/${encodeURIComponent(store.id)}/reception`;
            const staffLines = [
              `【ネット予約】${store.name}`,
              "",
              `予約番号: ${out.resId}`,
              `日付: ${date}`,
              `時間: ${time}`,
              `お名前: ${name}`,
              `電話: ${phoneNorm.phone}`,
              `人数: ${Math.floor(num)}名`,
              ...(out.seatLabels?.length ? [`席: ${out.seatLabels.join("、")}`] : []),
              ...(seatTypeMode === "require_select" && seatTypeBody ? [`席種別: ${seatTypeBody}`] : []),
              ...(note ? [`備考: ${note}`] : []),
              ...(emailForMail ? [`メール: ${emailForMail}`] : []),
              "",
              `受付画面: ${receptionUrl}`,
            ];
            void sendNotifyEmailList(
              staffNotifyTo,
              {
                subject: `【ネット予約】${date} ${time} ${name}様 ${Math.floor(num)}名`,
                text: staffLines.join("\n"),
              },
              { storeSettings: stSet },
            ).catch((err: unknown) =>
              req.log.warn({ err }, "net reserve staff notify mail failed"),
            );
          }
        }

        broadcastReceptionUpdated(store.id);
        return {
          ok: true,
          resId: out.resId,
          seats: out.seats,
          seatLabels: out.seatLabels,
          ...(seatTypeMode === "require_select" && seatTypeBody ? { seatType: seatTypeBody } : {}),
        };
      } catch (e: any) {
        const msg = String(e?.message || e);
        // Unique constraint hit means seat already locked; retry
        if (msg.includes("ReceptionReservationSeat_storeId_shiftKey_seatId_key")) continue;
        throw e;
      }
    }
    return reply.code(409).send({ error: "no available seats" });
  });

  /**
   * ネット予約のキャンセル（お客様・予約履歴から）。予約番号＋予約時の電話番号で本人確認。
   */
  app.post<{
    Params: { storeId: string; resId: string };
    Body: { phone?: unknown };
  }>("/reception/:storeId/net/reservations/:resId/cancel", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const resKey = typeof req.params.resId === "string" ? req.params.resId.trim() : "";
    if (!resKey || !resKey.startsWith("N")) {
      return reply.code(400).send({ error: "invalid reservation id" });
    }

    const phoneNorm = normalizeReceptionPhone(req.body?.phone);
    if (!phoneNorm.ok) return reply.code(400).send({ error: "phone required" });

    const row = await prisma.receptionReservation.findUnique({
      where: { storeId_resKey: { storeId: store.id, resKey } },
    });
    if (!row) {
      return reply.code(404).send({ error: "reservation not found or phone mismatch" });
    }

    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    const storedPhone = typeof data.phone === "string" ? data.phone : "";
    if (normalizePhoneDigits(storedPhone) !== normalizePhoneDigits(phoneNorm.phone)) {
      return reply.code(404).send({ error: "reservation not found or phone mismatch" });
    }

    const status = typeof data.status === "string" ? data.status : row.status || "";
    if (status === "キャンセル") {
      return { ok: true, resId: resKey, alreadyCancelled: true };
    }
    if (status === "来店済み") {
      return reply.code(400).send({ error: "already visited; cannot cancel online" });
    }

    const date = typeof data.date === "string" ? data.date : row.date;
    const shift = typeof data.shift === "string" ? data.shift : row.shift;
    const time = typeof data.time === "string" ? data.time : "";
    const name = typeof data.name === "string" ? data.name : "";
    const num = typeof data.num === "number" ? data.num : Number(data.num) || 0;
    const note = typeof data.note === "string" ? data.note : "";
    const seats = Array.isArray(data.seats)
      ? (data.seats as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];
    const seatType = typeof data.seatType === "string" ? data.seatType : "";

    const nextData = { ...data, status: "キャンセル" };

    try {
      await prisma.receptionReservation.update({
        where: { storeId_resKey: { storeId: store.id, resKey } },
        data: { data: nextData as never, status: "キャンセル" },
      });
      await syncReservationSeatLocks({
        storeId: store.id,
        resKey,
        date,
        shift,
        time,
        seats,
        status: "キャンセル",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(409).send({ error: msg || "cancel failed" });
    }

    const origin = staffRequestOrigin(req);
    const receptionUrl = `${origin}/staff-app/${encodeURIComponent(store.id)}/reception`;
    await maybeNotifyNetReserveCancelled(
      store,
      resKey,
      status,
      nextData,
      "キャンセル",
      receptionUrl,
      req.log,
    );

    broadcastReceptionUpdated(store.id);
    return { ok: true, resId: resKey, cancelled: true };
  });
}

