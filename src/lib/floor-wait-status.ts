import { prisma } from "../db.js";
import { mergeStoreSettings } from "./store-settings.js";

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
};

export const FLOOR_WAIT_STAFF_MANY_MIN = 10;

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
  };
}
