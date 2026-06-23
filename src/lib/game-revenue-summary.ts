import { prisma } from "../db.js";
import { orderLineNetAfterLineDiscount } from "./report-line-tax.js";
import { startOfWallCalendarDayUtc } from "./store-wall-time.js";

export function isGameFeeLineExtra(lineExtra: unknown): boolean {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return false;
  return (lineExtra as { kind?: unknown }).kind === "gameFee";
}

function parseStoreGameIdFromLineExtra(lineExtra: unknown): string | null {
  if (!isGameFeeLineExtra(lineExtra)) return null;
  const id = (lineExtra as { storeGameId?: unknown }).storeGameId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function monthYmdBounds(ym: string): { first: string; last: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null;
  const days = new Date(y, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { first: `${y}-${pad(mo)}-01`, last: `${y}-${pad(mo)}-${pad(days)}` };
}

function settledAtRangeForMonth(ym: string, timeZone: string): { gte: Date; lt: Date } | null {
  const bounds = monthYmdBounds(ym);
  if (!bounds) return null;
  const gte = startOfWallCalendarDayUtc(bounds.first, timeZone);
  const end = startOfWallCalendarDayUtc(bounds.last, timeZone);
  end.setTime(end.getTime() + 86400000);
  return { gte, lt: end };
}

export type GameRevenueByGame = {
  storeGameId: string | null;
  title: string;
  playCount: number;
  totalYen: number;
};

export type GameRevenueSummary = {
  month: string;
  timeZone: string;
  basis: "settled";
  totalYen: number;
  playCount: number;
  byGame: GameRevenueByGame[];
};

export async function summarizeGameRevenueForMonth(
  storeId: string,
  monthYm: string,
  timeZone: string,
): Promise<GameRevenueSummary | null> {
  const range = settledAtRangeForMonth(monthYm, timeZone);
  if (!range) return null;

  const byGameMap = new Map<
    string,
    { storeGameId: string | null; title: string; playCount: number; totalYen: number }
  >();
  let totalYen = 0;
  let playCount = 0;

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.bill.findMany({
      where: {
        storeId,
        status: "settled",
        settledAt: range,
      },
      take: 100,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        session: {
          select: {
            orders: {
              select: {
                lines: {
                  select: {
                    unitPrice: true,
                    qty: true,
                    status: true,
                    discountJson: true,
                    lineExtra: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (batch.length === 0) break;

    for (const bill of batch) {
      const orders = bill.session?.orders ?? [];
      for (const order of orders) {
        for (const line of order.lines) {
          if (!isGameFeeLineExtra(line.lineExtra)) continue;
          const net = orderLineNetAfterLineDiscount(line);
          if (net <= 0) continue;
          const qty = line.qty > 0 ? line.qty : 1;
          totalYen += net;
          playCount += qty;
          const storeGameId = parseStoreGameIdFromLineExtra(line.lineExtra);
          const extra = line.lineExtra as { gameTitle?: unknown };
          const title =
            typeof extra.gameTitle === "string" && extra.gameTitle.trim()
              ? extra.gameTitle.trim()
              : "（不明）";
          const key = storeGameId ?? `unknown:${title}`;
          const row = byGameMap.get(key) ?? { storeGameId, title, playCount: 0, totalYen: 0 };
          row.playCount += qty;
          row.totalYen += net;
          byGameMap.set(key, row);
        }
      }
    }
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < 100) break;
  }

  const byGame = [...byGameMap.values()].sort(
    (a, b) => b.totalYen - a.totalYen || a.title.localeCompare(b.title, "ja"),
  );

  return { month: monthYm, timeZone, basis: "settled", totalYen, playCount, byGame };
}
