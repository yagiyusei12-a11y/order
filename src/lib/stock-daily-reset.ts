import type { PrismaClient } from "@prisma/client";
import { mergeStoreSettings } from "./store-settings.js";

/** 店舗 TZ のカレンダー日付と、0時からの経過分（0〜1439） */
export function zonedDateAndMinutesFromMidnight(now: Date, timeZone: string): { dateStr: string; minutes: number } {
  const s = now.toLocaleString("sv-SE", { timeZone });
  const [datePart, timePart] = s.split(" ");
  const [hhS, mmS] = (timePart || "0:0:0").split(":");
  const hh = Number(hhS);
  const mm = Number(mmS);
  const minutes = (Number.isFinite(hh) && Number.isFinite(mm) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  const safeMin = Math.min(1439, Math.max(0, minutes));
  return { dateStr: datePart || "", minutes: safeMin };
}

/**
 * 全店舗について、日次在庫リセット時刻なら stockQty を stockDailyResetQty に合わせる。
 * 単一プロセス想定（複数ワーカーでは同日二重実行の可能性あり）。
 */
export async function runStockDailyResetForAllStores(prisma: PrismaClient, now: Date = new Date()): Promise<void> {
  const stores = await prisma.store.findMany({ select: { id: true, settings: true } });
  for (const store of stores) {
    const s = mergeStoreSettings(store.settings);
    if (!s.stockDailyResetEnabled) continue;

    const tz = s.timezone || "Asia/Tokyo";
    const { dateStr, minutes } = zonedDateAndMinutesFromMidnight(now, tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (minutes !== s.stockDailyResetTimeMin) continue;
    if (s.stockDailyResetLastRunDate === dateStr) continue;

    const targets = await prisma.menuItem.findMany({
      where: {
        stockDailyResetQty: { not: null },
        category: { storeId: store.id },
      },
      select: { id: true, stockDailyResetQty: true },
    });

    await prisma.$transaction(async (tx) => {
      for (const t of targets) {
        const q = t.stockDailyResetQty;
        if (q == null) continue;
        await tx.menuItem.update({
          where: { id: t.id },
          data: { stockQty: q, masterVersion: { increment: 1 } },
        });
      }

      const cur = await tx.store.findUnique({ where: { id: store.id }, select: { settings: true } });
      if (!cur) return;
      const merged = mergeStoreSettings(cur.settings);
      merged.stockDailyResetLastRunDate = dateStr;
      await tx.store.update({
        where: { id: store.id },
        data: { settings: merged as object },
      });
    });
  }
}
