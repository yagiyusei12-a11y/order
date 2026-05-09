/**
 * One-shot: DB に harunoyukoto の伝票が入っているか・settledAt の範囲を表示
 *   npx tsx prisma/report-debug-harunoyukoto.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function loadDotEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();
const prisma = new PrismaClient();
const sid = "harunoyukoto";

async function main(): Promise<void> {
  const total = await prisma.bill.count({ where: { storeId: sid } });
  const settled = await prisma.bill.count({ where: { storeId: sid, status: "settled" } });
  const agg = await prisma.bill.aggregate({
    where: { storeId: sid, status: "settled", settledAt: { not: null } },
    _min: { settledAt: true },
    _max: { settledAt: true },
  });
  const sampleAsc = await prisma.bill.findMany({
    where: { storeId: sid, status: "settled" },
    orderBy: { settledAt: "asc" },
    take: 3,
    select: { settledAt: true, totalAmount: true, label: true },
  });
  const sampleDesc = await prisma.bill.findMany({
    where: { storeId: sid, status: "settled" },
    orderBy: { settledAt: "desc" },
    take: 3,
    select: { settledAt: true, totalAmount: true, label: true },
  });
  const store = await prisma.store.findUnique({
    where: { id: sid },
    select: { id: true, name: true, settings: true },
  });
  let tz = "Asia/Tokyo";
  if (store?.settings && typeof store.settings === "object" && store.settings !== null) {
    const s = store.settings as Record<string, unknown>;
    if (typeof s.timezone === "string") tz = s.timezone;
  }

  console.log(
    JSON.stringify(
      {
        DATABASE_URL_host_hint: process.env.DATABASE_URL
          ? String(process.env.DATABASE_URL).replace(/:[^:@]+@/, ":****@")
          : "(unset)",
        storeId: sid,
        storeName: store?.name ?? "(missing)",
        storeTimezone: tz,
        billCount_allStatuses: total,
        billCount_settled: settled,
        settledAt_iso_min: agg._min.settledAt?.toISOString() ?? null,
        settledAt_iso_max: agg._max.settledAt?.toISOString() ?? null,
        sample_settledAt_earliest: sampleAsc.map((b) => ({
          settledAt: b.settledAt?.toISOString(),
          totalAmount: b.totalAmount,
          label: (b.label || "").slice(0, 60),
        })),
        sample_settledAt_latest: sampleDesc.map((b) => ({
          settledAt: b.settledAt?.toISOString(),
          totalAmount: b.totalAmount,
          label: (b.label || "").slice(0, 60),
        })),
        hint_reports_range:
          "レポートは精算済みの settledAt が「開始〜終了」に入った伝票のみ。CSVが2025年なら年を2025にし、終了は9月末の翌日0時など十分に含める。",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
