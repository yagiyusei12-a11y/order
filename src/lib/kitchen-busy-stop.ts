import { prisma } from "../db.js";

/** ゲスト画面・注文エラー用の固定文言 */
export const GUEST_BUSY_STOP_MESSAGE =
  "こちらの商品は混雑防止の為、一時的にご注文頂けません。";

/** 停止からこの時間経過後、キッチン／ホールにアラート */
export const BUSY_STOP_ALERT_AFTER_MS = 30 * 60 * 1000;

/** 解除されない場合の再アラート間隔 */
export const BUSY_STOP_ALERT_REPEAT_MS = 10 * 60 * 1000;

export type BusyStopMenuItemRef = {
  busyStopTarget: boolean;
  kitchenStationId: string | null;
};

export function isItemBusyStoppedByStations(
  item: BusyStopMenuItemRef,
  stoppedStationIds: ReadonlySet<string>,
): boolean {
  if (!item.busyStopTarget) return false;
  const sid = item.kitchenStationId;
  if (!sid) return false;
  return stoppedStationIds.has(sid);
}

/** 現在混雑停止中の調理場 ID */
export async function loadBusyStoppedStationIdSet(storeId: string): Promise<Set<string>> {
  const rows = await prisma.kitchenStation.findMany({
    where: { storeId, busyStoppedAt: { not: null } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

type SetStepChoiceRow = {
  componentMenuItem: {
    busyStopTarget?: boolean;
    kitchenStationId?: string | null;
  } | null;
};

type SetStepRow = {
  choices: SetStepChoiceRow[];
};

/** セット定義内に混雑停止対象の構成単品があるか */
export function setMenuItemBlockedByBusyStop(
  setItem: BusyStopMenuItemRef,
  setSteps: SetStepRow[],
  stoppedStationIds: ReadonlySet<string>,
): boolean {
  if (isItemBusyStoppedByStations(setItem, stoppedStationIds)) return true;
  for (const st of setSteps) {
    for (const ch of st.choices) {
      const comp = ch.componentMenuItem;
      if (comp && isItemBusyStoppedByStations(
        {
          busyStopTarget: comp.busyStopTarget === true,
          kitchenStationId: comp.kitchenStationId ?? null,
        },
        stoppedStationIds,
      )) return true;
    }
  }
  return false;
}

export type BusyStopStationStatusRow = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  busyStoppedAt: Date | null;
  /** この調理場に紐づく商品マスタ件数 */
  stationMenuItemCount: number;
  targetItemCount: number;
  /** キッチン未完了（待ち・調理中）の明細数。混雑停止後もキャンセルされない */
  inFlightKitchenLineCount: number;
};

/** 調理場ごとの商品マスタ件数 */
export async function loadStationMenuItemCountsByStation(
  storeId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.menuItem.groupBy({
    by: ["kitchenStationId"],
    where: {
      category: { storeId },
      kitchenStationId: { not: null },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sid = row.kitchenStationId;
    if (!sid) continue;
    counts.set(sid, row._count._all);
  }
  return counts;
}

/** 調理場に紐づく全商品を「混雑時停止対象」にする */
export async function markAllStationMenuItemsBusyStopTarget(
  storeId: string,
  stationId: string,
): Promise<{ updatedCount: number; targetItemCount: number }> {
  const station = await prisma.kitchenStation.findFirst({
    where: { id: stationId, storeId },
    select: { id: true },
  });
  if (!station) throw new Error("STATION_NOT_FOUND");

  const updated = await prisma.menuItem.updateMany({
    where: {
      kitchenStationId: stationId,
      category: { storeId },
      busyStopTarget: false,
    },
    data: {
      busyStopTarget: true,
      masterVersion: { increment: 1 },
    },
  });

  const targetItemCount = await prisma.menuItem.count({
    where: {
      kitchenStationId: stationId,
      category: { storeId },
      busyStopTarget: true,
    },
  });

  return { updatedCount: updated.count, targetItemCount };
}

/** 調理場ごとのキッチン未完了明細数（混雑停止の影響を受けない） */
export async function loadInFlightKitchenLineCountsByStation(
  storeId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.orderLine.findMany({
    where: {
      status: { in: ["queued", "cooking"] },
      order: { session: { storeId, status: "open" } },
      menuItem: { kitchenStationId: { not: null } },
    },
    select: { menuItem: { select: { kitchenStationId: true } } },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sid = row.menuItem?.kitchenStationId;
    if (!sid) continue;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  return counts;
}

/** 混雑停止管理画面・API 用 */
export async function listKitchenBusyStopStatus(storeId: string): Promise<BusyStopStationStatusRow[]> {
  const [stations, inFlightByStation, menuItemByStation] = await Promise.all([
    prisma.kitchenStation.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        _count: {
          select: {
            menuItems: {
              where: { busyStopTarget: true },
            },
          },
        },
      },
    }),
    loadInFlightKitchenLineCountsByStation(storeId),
    loadStationMenuItemCountsByStation(storeId),
  ]);
  return stations.map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    active: s.active,
    busyStoppedAt: s.busyStoppedAt,
    stationMenuItemCount: menuItemByStation.get(s.id) ?? 0,
    targetItemCount: s._count.menuItems,
    inFlightKitchenLineCount: inFlightByStation.get(s.id) ?? 0,
  }));
}

/** アラート対象（停止中かつ 30 分経過） */
export function busyStopStationsNeedingAlert(
  rows: Pick<BusyStopStationStatusRow, "id" | "name" | "busyStoppedAt">[],
  nowMs: number = Date.now(),
): { id: string; name: string; busyStoppedAt: string }[] {
  const out: { id: string; name: string; busyStoppedAt: string }[] = [];
  for (const row of rows) {
    if (!row.busyStoppedAt) continue;
    const t = row.busyStoppedAt.getTime();
    if (Number.isNaN(t)) continue;
    if (nowMs - t >= BUSY_STOP_ALERT_AFTER_MS) {
      out.push({
        id: row.id,
        name: row.name,
        busyStoppedAt: row.busyStoppedAt.toISOString(),
      });
    }
  }
  return out;
}
