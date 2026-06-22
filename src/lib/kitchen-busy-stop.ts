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
  targetItemCount: number;
};

/** 混雑停止管理画面・API 用 */
export async function listKitchenBusyStopStatus(storeId: string): Promise<BusyStopStationStatusRow[]> {
  const stations = await prisma.kitchenStation.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
    include: {
      _count: {
        select: {
          menuItems: {
            where: { busyStopTarget: true },
          },
        },
      },
    },
  });
  return stations.map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    active: s.active,
    busyStoppedAt: s.busyStoppedAt,
    targetItemCount: s._count.menuItems,
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
