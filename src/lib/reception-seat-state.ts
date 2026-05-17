import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { shiftFromTimeHHMM } from "./net-reserve-slots.js";
import { mergeStoreSettings } from "./store-settings.js";
import { storeNowWallClock } from "./store-wall-time.js";

export type ReceptionSeatStatus = "vacant" | "reserved" | "occupied" | "cleaning" | "closed";

export type DerivedSeatRow = {
  id: string;
  status: ReceptionSeatStatus;
  current: number;
  cleanStart: number | null;
  entryTime: number | null;
  capacity: number;
  mergeWith: string[];
  seatType: string;
};

function receptionLunchEndHour(configData: Record<string, unknown>): number {
  const n = Number(configData.receptionShiftLunchEndHour);
  if (!Number.isFinite(n)) return 15;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

export function buildTodayReceptionShiftKey(timeZone: string, lunchEndHour: number): string {
  const { dateYmd, timeHHMM } = storeNowWallClock(timeZone);
  const shift = shiftFromTimeHHMM(timeHHMM, lunchEndHour) ?? "dinner";
  return `${dateYmd}_${shift}`;
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
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

export async function computeDefaultSeatsForShift(storeId: string): Promise<DerivedSeatRow[]> {
  const tables = await prisma.table.findMany({
    where: { storeId, active: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, publicCode: true, capacity: true, mergeWith: true, seatType: true },
  });
  const sessions = await prisma.diningSession.findMany({
    where: { storeId, status: { in: ["open", "bashing_waiting", "merged"] } },
    select: { id: true, tableId: true, status: true, guestCount: true, openedAt: true },
  });
  const sessByTableId = new Map(sessions.map((s) => [s.tableId, s]));
  const out: DerivedSeatRow[] = [];
  for (const t of tables) {
    const pc = String(t.publicCode ?? "").trim();
    if (!pc) continue;
    const seatType = String(t.seatType ?? "").trim();
    const s = sessByTableId.get(t.id);
    const mergeWith = Array.isArray(t.mergeWith)
      ? (t.mergeWith as unknown[]).filter((x) => typeof x === "string") as string[]
      : [];
    const capacity = Math.max(1, Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : 2);
    if (!s) {
      out.push({
        id: pc,
        status: "vacant",
        current: 0,
        cleanStart: null,
        entryTime: null,
        capacity,
        mergeWith,
        seatType,
      });
      continue;
    }
    if (s.status === "bashing_waiting") {
      out.push({
        id: pc,
        status: "cleaning",
        current: Number(s.guestCount || 0),
        cleanStart: Date.now(),
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
        capacity,
        mergeWith,
        seatType,
      });
    } else {
      out.push({
        id: pc,
        status: "occupied",
        current: Number(s.guestCount || 0),
        cleanStart: null,
        entryTime: s.openedAt ? s.openedAt.getTime() : null,
        capacity,
        mergeWith,
        seatType,
      });
    }
  }
  return out;
}

function seatRowFromDerived(d: DerivedSeatRow): Record<string, unknown> {
  return {
    id: d.id,
    status: d.status,
    current: d.current,
    cleanStart: d.cleanStart,
    entryTime: d.entryTime,
    capacity: d.capacity,
    mergeWith: d.mergeWith,
    seatType: d.seatType,
  };
}

/**
 * 保存済み receptionShift.seats を DiningSession のライブ状態で上書きする。
 * reserved はセッション未開始の案内用のみ。open / bashing は常に derived が優先。
 */
export function mergeShiftSeatsWithLiveDerived(seats: unknown[], derived: DerivedSeatRow[]): unknown[] {
  const byId = new Map(derived.map((d) => [d.id, d]));
  const merged = seats.map((row) => {
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
      o.seatType = d.seatType;
      return o;
    }
    if (o.status === "reserved" && d.status === "vacant") {
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
      o.seatType = d.seatType;
      return o;
    }
    if (o.status === "occupied" || o.status === "cleaning") {
      o.status = d.status;
      o.current = d.current;
      o.cleanStart = d.cleanStart;
      o.entryTime = d.entryTime;
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
      o.seatType = d.seatType;
    } else {
      o.capacity = d.capacity;
      o.mergeWith = d.mergeWith;
      o.seatType = d.seatType;
    }
    return o;
  });
  const seen = new Set<string>();
  for (const row of merged) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = typeof (row as Record<string, unknown>).id === "string" ? String((row as Record<string, unknown>).id) : "";
    if (id) seen.add(id);
  }
  const extra: unknown[] = [];
  for (const d of derived) {
    if (!seen.has(d.id)) extra.push(seatRowFromDerived(d));
  }
  return extra.length ? [...merged, ...extra] : merged;
}

/** 卓のセッション変化を当日シフトの seats JSON に反映（受付マップの色ずれ防止） */
export async function syncReceptionShiftSeatsForTable(storeId: string, tableId: string): Promise<void> {
  const table = await prisma.table.findFirst({
    where: { id: tableId, storeId, active: true },
    select: { publicCode: true },
  });
  const pc = String(table?.publicCode ?? "").trim();
  if (!pc) return;

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
  if (!store) return;
  const stSet = mergeStoreSettings(store.settings);
  const confRow = await prisma.receptionConfig.findUnique({ where: { storeId } });
  const cData = (confRow?.data as Record<string, unknown>) || {};
  const shiftKey = buildTodayReceptionShiftKey(stSet.timezone, receptionLunchEndHour(cData));

  await ensureShift(storeId, shiftKey);
  const derived = await computeDefaultSeatsForShift(storeId);
  const sh = await prisma.receptionShift.findUnique({
    where: { storeId_shiftKey: { storeId, shiftKey } },
    select: { seats: true },
  });
  let seats = Array.isArray((sh?.seats as unknown) as unknown[]) ? ((sh?.seats as unknown[]) ?? []) : [];
  if (!seats.length) {
    seats = derived as unknown[];
  } else {
    seats = mergeShiftSeatsWithLiveDerived(seats, derived) as unknown[];
  }
  await prisma.receptionShift.update({
    where: { storeId_shiftKey: { storeId, shiftKey } },
    data: { seats: seats as never },
  });
}
