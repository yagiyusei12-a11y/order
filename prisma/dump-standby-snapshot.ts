/**
 * 本番（または任意）DB から非常用シード用スナップショットを書き出す。
 * 注文・会計は含めない。
 *
 *   npx tsx prisma/dump-standby-snapshot.ts [--store harunoyukoto] [--out prisma/data/standby-snapshot.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

function argVal(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const STORE_ID = argVal("--store", "harunoyukoto");
const OUT = argVal("--out", join(process.cwd(), "prisma", "data", "standby-snapshot.json"));

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: STORE_ID } });
  if (!store) {
    console.error("store not found:", STORE_ID);
    process.exit(1);
  }
  const [tables, categories, kitchenStations] = await Promise.all([
    prisma.table.findMany({ where: { storeId: STORE_ID }, orderBy: { sortOrder: "asc" } }),
    prisma.menuCategory.findMany({
      where: { storeId: STORE_ID },
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.kitchenStation.findMany({ where: { storeId: STORE_ID }, orderBy: { sortOrder: "asc" } }),
  ]);

  const payload = {
    dumpedAt: new Date().toISOString(),
    store: { id: store.id, name: store.name, settings: store.settings },
    kitchenStations: kitchenStations.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      publicCode: t.publicCode,
      sortOrder: t.sortOrder,
      capacity: t.capacity,
      seatType: t.seatType,
      active: t.active,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      visibleToGuest: c.visibleToGuest,
      parentId: c.parentId,
    })),
    items: categories.flatMap((c) =>
      c.items.map((it) => ({
        id: it.id,
        categoryId: it.categoryId,
        name: it.name,
        description: it.description,
        imageUrl: it.imageUrl,
        recipe: it.recipe,
        price: it.price,
        priceTaxMode: it.priceTaxMode,
        sellKind: it.sellKind,
        sortOrder: it.sortOrder,
        isAvailable: it.isAvailable,
        containsAlcohol: it.containsAlcohol,
        allowTakeout: it.allowTakeout,
        cookTimerSec: it.cookTimerSec,
        cookTimerSec2: it.cookTimerSec2,
      })),
    ),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log("Wrote", OUT, "items=", payload.items.length, "tables=", payload.tables.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
