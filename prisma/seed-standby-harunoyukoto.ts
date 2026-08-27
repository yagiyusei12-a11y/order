/**
 * 非常用VPS向け: 店舗 harunoyukoto の商品・席・支払・税設定を空の注文で用意する。
 *
 *   npx tsx prisma/seed-standby-harunoyukoto.ts
 *
 * prisma/data/standby-snapshot.json があれば ID 付きで復元（本番突合用）。
 * なければ CSV + 席シード。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

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
const prisma = new PrismaClient();
const STORE_ID = "harunoyukoto";
const SNAPSHOT = join(process.cwd(), "prisma", "data", "standby-snapshot.json");

function seatLabels(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 10; i++) out.push(`C${String(i).padStart(2, "0")}`);
  for (let i = 21; i <= 24; i++) out.push(`T${i}`);
  for (let i = 31; i <= 37; i++) out.push(`T${i}`);
  for (let i = 52; i <= 54; i++) out.push(`T${i}`);
  for (let i = 61; i <= 64; i++) out.push(`T${i}`);
  return out;
}

async function ensureStore(): Promise<void> {
  const receiptIp = String(process.env.STANDBY_RECEIPT_PRINTER_IP || "").trim();
  const kitchenIp = String(process.env.STANDBY_KITCHEN_PRINTER_IP || "").trim();
  const settings: Record<string, unknown> = {
    timezone: "Asia/Tokyo",
    taxRatePercent: 10,
    menuPriceTaxMode: "exclusive",
    coursePriceTaxMode: "exclusive",
    thermalReceiptPrinterIp: receiptIp,
    thermalKitchenPrinterIp: kitchenIp,
    thermalPrinterPort: 9100,
    thermalKitchenAutoPrint: Boolean(kitchenIp),
  };
  const existing = await prisma.store.findUnique({ where: { id: STORE_ID } });
  if (!existing) {
    await prisma.store.create({
      data: { id: STORE_ID, name: "はるのゆこと", settings: settings as Prisma.InputJsonValue },
    });
    console.log("Created store", STORE_ID);
    return;
  }
  const prev =
    existing.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
      ? (existing.settings as Record<string, unknown>)
      : {};
  await prisma.store.update({
    where: { id: STORE_ID },
    data: {
      name: existing.name || "はるのゆこと",
      settings: { ...prev, ...settings } as Prisma.InputJsonValue,
    },
  });
}

async function ensureStorePaymentMethods(): Promise<void> {
  const defs = await prisma.paymentMethodDefinition.findMany({ orderBy: { sortOrder: "asc" } });
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    await prisma.storePaymentMethod.upsert({
      where: { storeId_definitionId: { storeId: STORE_ID, definitionId: def.id } },
      create: {
        storeId: STORE_ID,
        definitionId: def.id,
        enabled: true,
        sortOrder: def.sortOrder || 10 + i,
      },
      update: { enabled: true },
    });
  }
  console.log("Payment methods linked:", defs.length);
}

async function ensureTablesFromLabels(): Promise<void> {
  const labels = seatLabels();
  for (let i = 0; i < labels.length; i++) {
    const name = labels[i];
    const publicCode = `${STORE_ID}-${name.toLowerCase()}`;
    await prisma.table.upsert({
      where: { publicCode },
      create: {
        storeId: STORE_ID,
        name,
        publicCode,
        sortOrder: i + 1,
        active: true,
      },
      update: { name, sortOrder: i + 1, active: true },
    });
  }
  const takeoutCode = `takeout-${STORE_ID}`;
  await prisma.table.upsert({
    where: { publicCode: takeoutCode },
    create: {
      storeId: STORE_ID,
      name: "テイクアウト",
      publicCode: takeoutCode,
      sortOrder: 9000,
      active: true,
    },
    update: { name: "テイクアウト", active: true },
  });
  console.log(`Tables: ${labels.length} + takeout`);
}

type Snapshot = {
  store?: { id: string; name: string; settings?: unknown };
  tables?: Array<{
    id: string;
    name: string;
    publicCode: string;
    sortOrder: number;
    capacity?: number;
    seatType?: string;
    active?: boolean;
  }>;
  categories?: Array<{
    id: string;
    name: string;
    sortOrder: number;
    visibleToGuest?: boolean;
    parentId?: string | null;
  }>;
  items?: Array<{
    id: string;
    categoryId: string;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    recipe?: string | null;
    price: number;
    priceTaxMode?: string;
    sellKind?: string;
    sortOrder?: number;
    isAvailable?: boolean;
    containsAlcohol?: boolean;
    allowTakeout?: boolean;
    cookTimerSec?: number | null;
    cookTimerSec2?: number | null;
  }>;
  kitchenStations?: Array<{ id: string; name: string; sortOrder?: number }>;
};

async function restoreSnapshot(snap: Snapshot): Promise<void> {
  if (snap.store) {
    await prisma.store.update({
      where: { id: STORE_ID },
      data: {
        name: snap.store.name || "はるのゆこと",
        settings: (snap.store.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
  for (const st of snap.kitchenStations || []) {
    await prisma.kitchenStation.upsert({
      where: { id: st.id },
      create: {
        id: st.id,
        storeId: STORE_ID,
        name: st.name,
        sortOrder: st.sortOrder ?? 0,
      },
      update: { name: st.name, sortOrder: st.sortOrder ?? 0 },
    });
  }
  const cats = [...(snap.categories || [])].sort((a, b) => {
    const ap = a.parentId ? 1 : 0;
    const bp = b.parentId ? 1 : 0;
    return ap - bp;
  });
  for (const c of cats) {
    await prisma.menuCategory.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        storeId: STORE_ID,
        name: c.name,
        sortOrder: c.sortOrder,
        visibleToGuest: c.visibleToGuest !== false,
        parentId: c.parentId ?? null,
      },
      update: {
        name: c.name,
        sortOrder: c.sortOrder,
        visibleToGuest: c.visibleToGuest !== false,
        parentId: c.parentId ?? null,
      },
    });
  }
  for (const it of snap.items || []) {
    await prisma.menuItem.upsert({
      where: { id: it.id },
      create: {
        id: it.id,
        categoryId: it.categoryId,
        name: it.name,
        description: it.description ?? null,
        imageUrl: it.imageUrl ?? null,
        recipe: it.recipe ?? null,
        price: it.price,
        priceTaxMode: it.priceTaxMode === "inclusive" ? "inclusive" : "exclusive",
        sellKind: it.sellKind === "set" ? "set" : "single",
        sortOrder: it.sortOrder ?? 0,
        isAvailable: it.isAvailable !== false,
        containsAlcohol: it.containsAlcohol === true,
        allowTakeout: it.allowTakeout === true,
        cookTimerSec: it.cookTimerSec ?? null,
        cookTimerSec2: it.cookTimerSec2 ?? null,
      },
      update: {
        categoryId: it.categoryId,
        name: it.name,
        description: it.description ?? null,
        imageUrl: it.imageUrl ?? null,
        recipe: it.recipe ?? null,
        price: it.price,
        priceTaxMode: it.priceTaxMode === "inclusive" ? "inclusive" : "exclusive",
        sortOrder: it.sortOrder ?? 0,
        isAvailable: it.isAvailable !== false,
        containsAlcohol: it.containsAlcohol === true,
        allowTakeout: it.allowTakeout === true,
        cookTimerSec: it.cookTimerSec ?? null,
        cookTimerSec2: it.cookTimerSec2 ?? null,
      },
    });
  }
  for (const t of snap.tables || []) {
    await prisma.table.upsert({
      where: { publicCode: t.publicCode },
      create: {
        id: t.id,
        storeId: STORE_ID,
        name: t.name,
        publicCode: t.publicCode,
        sortOrder: t.sortOrder,
        capacity: t.capacity ?? 2,
        seatType: t.seatType ?? "",
        active: t.active !== false,
      },
      update: {
        name: t.name,
        sortOrder: t.sortOrder,
        active: t.active !== false,
      },
    });
  }
  console.log(
    `Snapshot restored: cats=${(snap.categories || []).length} items=${(snap.items || []).length} tables=${(snap.tables || []).length}`,
  );
}

async function main(): Promise<void> {
  await ensureStore();
  await ensureStorePaymentMethods();

  if (existsSync(SNAPSHOT)) {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
    await restoreSnapshot(snap);
    return;
  }

  await ensureTablesFromLabels();
  const csv = join(process.cwd(), "prisma", "data", "harunoyukoto-nagahama-menu.csv");
  if (!existsSync(csv)) {
    console.warn("Menu CSV missing, skip import:", csv);
    return;
  }
  console.log("Importing menu CSV (merge)...");
  execSync(`npx tsx prisma/import-menu-csv.ts "${csv}" ${STORE_ID} --merge`, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
