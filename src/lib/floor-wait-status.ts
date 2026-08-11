import { prisma } from "../db.js";
import { mergeStoreSettings } from "./store-settings.js";
import { minutesSinceMidnightInTimeZone } from "./guest-category-hours.js";
import { storeNowWallClock } from "./store-wall-time.js";

export type FloorWaitLevel = "normal" | "delay" | "prepare_seats";

/**
 * キッチン遅延調査（注文→調理済）に基づく閾値。
 * 進行中＝queued/cooking の明細「本数」（個数合計ではない）。
 * 未注文席は使わない（誤警報の主因だったため）。
 */
export type FloorWaitThresholds = {
  staffManyMin: number;
  /** 全体: この本数以上で遅延告知（〜prepareMin-1） */
  delayMin: number;
  /** 全体: この本数以上で席用意 */
  prepareMin: number;
  /** 揚げ場/焼き場: この本数以上で遅延告知 */
  stationDelayMin: number;
  /** 揚げ場/焼き場: この本数以上で席用意 */
  stationPrepareMin: number;
};

export const FLOOR_WAIT_STAFF_MANY_MIN = 10;

/** 席用意警告中のネット予約最短リード（分）。通常の枠フィルタは 5 分。 */
export const PREPARE_SEATS_NET_RESERVE_LEAD_MINUTES = 30;
export const NET_RESERVE_DEFAULT_LEAD_MINUTES = 5;

export type UpcomingNetReservation = {
  resId: string;
  time: string;
  name: string;
  num: number;
  status: string;
};

export type FloorWaitStatus = {
  level: FloorWaitLevel;
  labelJa: string;
  /** 進行中明細の本数（queued+cooking） */
  inFlightLineCount: number;
  /** 互換・表示用: 進行中の数量合計 */
  orderQty: number;
  fryStationInFlight: number;
  grillStationInFlight: number;
  onDutyStaffCount: number;
  staffingMode: "many" | "few";
  thresholds: FloorWaitThresholds;
  /** どの条件で発火したか（デバッグ・tooltip用） */
  trigger: "none" | "total" | "fry" | "grill";
  /** 席用意中はネット予約をこの分数以降に制限 */
  netReserveMinLeadMinutes: number;
  /** 席用意中かつ30分以内に既存予約があるとき */
  upcomingReservationsWithinLead: UpcomingNetReservation[];
};

/** 調理場名の正規化照合（全角半角差を吸収） */
export function normalizeKitchenStationName(s: unknown): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .normalize("NFKC");
}

export function isFryStationName(name: unknown): boolean {
  const n = normalizeKitchenStationName(name);
  return n === "揚げ場" || n.includes("揚げ");
}

export function isGrillStationName(name: unknown): boolean {
  const n = normalizeKitchenStationName(name);
  return n === "焼き場" || n.includes("焼き");
}

/**
 * 多人数（10人〜）: 全体 20–24 / 25〜、揚げ・焼き 12〜 / 16〜
 * 少人数（〜9人）: 一段下げ 全体 18–22 / 23〜、揚げ・焼き 10〜 / 14〜
 */
export function floorWaitThresholdsForStaffCount(onDutyStaffCount: number): FloorWaitThresholds {
  const n = Math.max(1, Math.floor(Number(onDutyStaffCount) || 1));
  if (n >= FLOOR_WAIT_STAFF_MANY_MIN) {
    return {
      staffManyMin: FLOOR_WAIT_STAFF_MANY_MIN,
      delayMin: 20,
      prepareMin: 25,
      stationDelayMin: 12,
      stationPrepareMin: 16,
    };
  }
  return {
    staffManyMin: FLOOR_WAIT_STAFF_MANY_MIN,
    delayMin: 18,
    prepareMin: 23,
    stationDelayMin: 10,
    stationPrepareMin: 14,
  };
}

export function resolveFloorWaitLevel(input: {
  inFlightLineCount: number;
  fryStationInFlight: number;
  grillStationInFlight: number;
  onDutyStaffCount: number;
}): { level: FloorWaitLevel; trigger: FloorWaitStatus["trigger"] } {
  const total = Math.max(0, Math.floor(Number(input.inFlightLineCount) || 0));
  const fry = Math.max(0, Math.floor(Number(input.fryStationInFlight) || 0));
  const grill = Math.max(0, Math.floor(Number(input.grillStationInFlight) || 0));
  const t = floorWaitThresholdsForStaffCount(input.onDutyStaffCount);

  if (total >= t.prepareMin) return { level: "prepare_seats", trigger: "total" };
  if (fry >= t.stationPrepareMin) return { level: "prepare_seats", trigger: "fry" };
  if (grill >= t.stationPrepareMin) return { level: "prepare_seats", trigger: "grill" };

  if (total >= t.delayMin) return { level: "delay", trigger: "total" };
  if (fry >= t.stationDelayMin) return { level: "delay", trigger: "fry" };
  if (grill >= t.stationDelayMin) return { level: "delay", trigger: "grill" };

  return { level: "normal", trigger: "none" };
}

export function floorWaitLabelJa(level: FloorWaitLevel): string {
  if (level === "prepare_seats") return "15分～25分以内に席をご用意";
  if (level === "delay") return "遅れる事を告知";
  return "通常";
}

export function netReserveLeadMinutesForFloorWaitLevel(level: FloorWaitLevel): number {
  return level === "prepare_seats"
    ? PREPARE_SEATS_NET_RESERVE_LEAD_MINUTES
    : NET_RESERVE_DEFAULT_LEAD_MINUTES;
}

function hhmmToMinutes(timeHHMM: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeHHMM || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

async function loadUpcomingReservationsWithinLead(
  storeId: string,
  timezone: string,
  leadMinutes: number,
): Promise<UpcomingNetReservation[]> {
  const clock = storeNowWallClock(timezone);
  const nowMin = minutesSinceMidnightInTimeZone(new Date(), timezone);
  const untilMin = nowMin + Math.max(0, Math.floor(leadMinutes));
  const rows = await prisma.receptionReservation.findMany({
    where: { storeId, date: clock.dateYmd },
    select: { resKey: true, status: true, data: true },
  });
  const out: UpcomingNetReservation[] = [];
  for (const row of rows) {
    const d =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    const status =
      (typeof d.status === "string" && d.status.trim()) ||
      (typeof row.status === "string" && row.status.trim()) ||
      "予約確定";
    if (status === "キャンセル" || status === "来店済み") continue;
    const time = typeof d.time === "string" ? d.time.trim() : "";
    const tm = hhmmToMinutes(time);
    if (tm == null) continue;
    if (tm < nowMin || tm > untilMin) continue;
    out.push({
      resId: String(d.resId || row.resKey || ""),
      time,
      name: typeof d.name === "string" ? d.name : "",
      num: Number.isFinite(Number(d.num)) ? Math.floor(Number(d.num)) : 0,
      status,
    });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

export async function loadFloorWaitStatus(storeId: string): Promise<FloorWaitStatus | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, settings: true },
  });
  if (!store) return null;

  const st = mergeStoreSettings(store.settings);
  const onDutyStaffCount = Math.min(99, Math.max(1, Math.round(Number(st.floorWaitOnDutyStaffCount) || 10)));
  const thresholds = floorWaitThresholdsForStaffCount(onDutyStaffCount);
  const staffingMode: "many" | "few" = onDutyStaffCount >= FLOOR_WAIT_STAFF_MANY_MIN ? "many" : "few";

  if (st.floorWaitForceLevel === "normal" || st.floorWaitForceLevel === "delay" || st.floorWaitForceLevel === "prepare_seats") {
    const lead = netReserveLeadMinutesForFloorWaitLevel(st.floorWaitForceLevel);
    const upcoming =
      st.floorWaitForceLevel === "prepare_seats"
        ? await loadUpcomingReservationsWithinLead(store.id, st.timezone, lead)
        : [];
    return {
      level: st.floorWaitForceLevel,
      labelJa: floorWaitLabelJa(st.floorWaitForceLevel),
      inFlightLineCount:
        st.floorWaitForceLevel === "prepare_seats"
          ? thresholds.prepareMin
          : st.floorWaitForceLevel === "delay"
            ? thresholds.delayMin
            : 0,
      orderQty: 0,
      fryStationInFlight: 0,
      grillStationInFlight: 0,
      onDutyStaffCount,
      staffingMode,
      thresholds,
      trigger: "none",
      netReserveMinLeadMinutes: lead,
      upcomingReservationsWithinLead: upcoming,
    };
  }

  const lines = await prisma.orderLine.findMany({
    where: {
      status: { in: ["queued", "cooking"] },
      order: { session: { storeId: store.id, status: "open" } },
    },
    select: {
      qty: true,
      menuItem: { select: { kitchenStation: { select: { name: true } } } },
    },
  });

  let orderQty = 0;
  let fryStationInFlight = 0;
  let grillStationInFlight = 0;
  for (const l of lines) {
    orderQty += Math.max(1, Number(l.qty) || 1);
    const stationName = l.menuItem?.kitchenStation?.name;
    if (isFryStationName(stationName)) fryStationInFlight += 1;
    if (isGrillStationName(stationName)) grillStationInFlight += 1;
  }
  const inFlightLineCount = lines.length;

  const resolved = resolveFloorWaitLevel({
    inFlightLineCount,
    fryStationInFlight,
    grillStationInFlight,
    onDutyStaffCount,
  });
  const lead = netReserveLeadMinutesForFloorWaitLevel(resolved.level);
  const upcoming =
    resolved.level === "prepare_seats"
      ? await loadUpcomingReservationsWithinLead(store.id, st.timezone, lead)
      : [];

  return {
    level: resolved.level,
    labelJa: floorWaitLabelJa(resolved.level),
    inFlightLineCount,
    orderQty,
    fryStationInFlight,
    grillStationInFlight,
    onDutyStaffCount,
    staffingMode,
    thresholds,
    trigger: resolved.trigger,
    netReserveMinLeadMinutes: lead,
    upcomingReservationsWithinLead: upcoming,
  };
}
