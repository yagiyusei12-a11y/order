import { prisma } from "../db.js";
import { mergeStoreSettings } from "./store-settings.js";
import {
  buildTodayReceptionShiftKey,
  computeDefaultSeatsForShift,
  mergeShiftSeatsWithLiveDerived,
} from "./reception-seat-state.js";
import { normalizeReceptionSeatStatus } from "./reception-seat-status.js";

export type FloorWaitLevel = "normal" | "delay" | "prepare_seats";

export type FloorWaitStatus = {
  level: FloorWaitLevel;
  labelJa: string;
  /** キッチン進行中（queued/cooking）の数量合計 */
  orderQty: number;
  /** カウンター以外・オレンジ(guiding)または青(occupied)で未注文の席数 */
  unorderedNonCounterWaitSeats: number;
};

function normalizeSeatTypeLabel(s: unknown): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC");
}

/** reception.ts と同趣旨: カウンター卓は待ち人数カウントから除外 */
export function isCounterTableRow(t: { publicCode: string; seatType?: string | null }): boolean {
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

function receptionLunchEndHour(configData: Record<string, unknown>): number {
  const n = Number(configData.receptionShiftLunchEndHour);
  if (!Number.isFinite(n)) return 15;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

/**
 * 優先度:
 * 1. 席をご用意 … 注文個数≥25 または（個数≤15 かつ 未注文オレンジ/青≥5）
 * 2. 遅れる告知 … 注文個数 16〜24
 * 3. 通常 … それ以外
 */
export function resolveFloorWaitLevel(
  orderQty: number,
  unorderedNonCounterWaitSeats: number,
): FloorWaitLevel {
  const qty = Math.max(0, Math.floor(Number(orderQty) || 0));
  const wait = Math.max(0, Math.floor(Number(unorderedNonCounterWaitSeats) || 0));
  if (qty >= 25 || (qty <= 15 && wait >= 5)) return "prepare_seats";
  if (qty >= 16 && qty <= 24) return "delay";
  return "normal";
}

export function floorWaitLabelJa(level: FloorWaitLevel): string {
  if (level === "prepare_seats") return "15分～25分以内に席をご用意";
  if (level === "delay") return "遅れる事を告知";
  return "通常";
}

export async function loadFloorWaitStatus(storeId: string): Promise<FloorWaitStatus | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, settings: true },
  });
  if (!store) return null;

  const st = mergeStoreSettings(store.settings);
  if (st.floorWaitForceLevel === "normal" || st.floorWaitForceLevel === "delay" || st.floorWaitForceLevel === "prepare_seats") {
    return {
      level: st.floorWaitForceLevel,
      labelJa: floorWaitLabelJa(st.floorWaitForceLevel),
      orderQty: st.floorWaitForceLevel === "prepare_seats" ? 25 : st.floorWaitForceLevel === "delay" ? 20 : 0,
      unorderedNonCounterWaitSeats: st.floorWaitForceLevel === "prepare_seats" ? 5 : 0,
    };
  }

  const conf = await prisma.receptionConfig.findUnique({
    where: { storeId: store.id },
    select: { data: true },
  });
  const cData =
    conf?.data && typeof conf.data === "object" && !Array.isArray(conf.data)
      ? (conf.data as Record<string, unknown>)
      : {};
  const lunchEnd = receptionLunchEndHour(cData);
  const shiftKey = buildTodayReceptionShiftKey(st.timezone, lunchEnd);

  const [qtyAgg, derived, shift, tables, orderedSessions] = await Promise.all([
    prisma.orderLine.aggregate({
      where: {
        status: { in: ["queued", "cooking"] },
        order: { session: { storeId: store.id, status: "open" } },
      },
      _sum: { qty: true },
    }),
    computeDefaultSeatsForShift(store.id),
    prisma.receptionShift.findUnique({
      where: { storeId_shiftKey: { storeId: store.id, shiftKey } },
      select: { seats: true },
    }),
    prisma.table.findMany({
      where: { storeId: store.id, active: true },
      select: { id: true, publicCode: true, seatType: true },
    }),
    prisma.diningSession.findMany({
      where: {
        storeId: store.id,
        status: { in: ["open", "merged"] },
        orders: { some: {} },
      },
      select: { tableId: true },
    }),
  ]);

  const orderQty = Math.max(0, Math.floor(Number(qtyAgg._sum.qty) || 0));
  const orderedTableIds = new Set(orderedSessions.map((s) => s.tableId));

  let seats: unknown[] = Array.isArray(shift?.seats) ? (shift!.seats as unknown[]) : [];
  if (!seats.length) {
    seats = derived as unknown[];
  } else {
    seats = mergeShiftSeatsWithLiveDerived(seats, derived);
  }

  const tableByCode = new Map<string, (typeof tables)[number]>();
  for (const t of tables) {
    const pc = String(t.publicCode ?? "").trim();
    if (pc) tableByCode.set(pc, t);
  }

  let unorderedNonCounterWaitSeats = 0;
  for (const row of seats) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const code = typeof o.id === "string" ? o.id.trim() : "";
    if (!code) continue;
    const table = tableByCode.get(code);
    if (!table || isCounterTableRow(table)) continue;
    const status = normalizeReceptionSeatStatus(o.status);
    if (status === "guiding") {
      unorderedNonCounterWaitSeats += 1;
      continue;
    }
    if (status === "occupied" && !orderedTableIds.has(table.id)) {
      unorderedNonCounterWaitSeats += 1;
    }
  }

  const level = resolveFloorWaitLevel(orderQty, unorderedNonCounterWaitSeats);
  return {
    level,
    labelJa: floorWaitLabelJa(level),
    orderQty,
    unorderedNonCounterWaitSeats,
  };
}
