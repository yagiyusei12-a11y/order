/**
 * 商品マスタCSV取り込み（カテゴリ＋商品）
 *
 * 想定ヘッダ（1行目）:
 *   商品名,商品ID,カテゴリー,カテゴリーID,価格,税込税抜,税率
 *
 * 使い方:
 *   npx tsx prisma/import-menu-csv.ts "C:\\path\\to\\file.csv" [storeId] [--merge]
 *
 *   --merge を付けない場合: 対象店舗の既存メニューカテゴリ・商品をすべて削除してから取り込む
 *   （コースに紐づく CourseMenuItem も商品削除で消えます。デモ用 seed-store-1 向け想定）
 *
 *   --merge: 既存データは消さず、安定IDで upsert（同名同カテゴリは上書き）
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { mergeStoreSettings } from "../src/lib/store-settings.js";

const prisma = new PrismaClient();

function stableId(prefix: string, parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
  return `${prefix}_${h.slice(0, 26)}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseTaxMode(s: string): "inclusive" | "exclusive" {
  const t = (s || "").trim();
  if (t.includes("税抜")) return "exclusive";
  if (t.includes("税込")) return "inclusive";
  return "inclusive";
}

function pickItemId(storeId: string, categoryName: string, productName: string, extProductId: string): string {
  const pid = (extProductId || "").trim();
  if (pid && /^[a-zA-Z0-9_-]+$/.test(pid) && pid.length <= 48) {
    return `csv-pid_${pid}`;
  }
  return stableId("csvitem", [storeId, categoryName, productName]);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--merge");
  const merge = process.argv.includes("--merge");
  const csvPath = argv[0];
  const storeId = argv[1] || process.env.IMPORT_STORE_ID || "seed-store-1";
  if (!csvPath) {
    console.error(
      "Usage: npx tsx prisma/import-menu-csv.ts <path-to.csv> [storeId] [--merge]\n" +
        "  default storeId: seed-store-1 or IMPORT_STORE_ID env"
    );
    process.exit(1);
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) {
    console.error(`store not found: ${storeId}`);
    process.exit(1);
  }

  let raw = readFileSync(csvPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.replace(/^\ufeff/, ""));
  const idx = (name: string) => header.indexOf(name);
  const iName = idx("商品名");
  const iPid = idx("商品ID");
  const iCat = idx("カテゴリー");
  const iCid = idx("カテゴリーID");
  const iPrice = idx("価格");
  const iTax = idx("税込税抜");
  const iRate = idx("税率");
  if (iName < 0 || iCat < 0 || iPrice < 0 || iTax < 0) {
    console.error("CSV header must include 商品名, カテゴリー, 価格, 税込税抜");
    process.exit(1);
  }
  if (iCid >= 0) console.warn("カテゴリーID column is ignored (categories are named by カテゴリー).");

  type Row = {
    name: string;
    extPid: string;
    categoryName: string;
    price: number;
    priceTaxMode: "inclusive" | "exclusive";
    taxRate: number | null;
  };
  const rows: Row[] = [];
  const taxRates = new Set<number>();
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    const name = (cols[iName] || "").trim();
    const categoryName = (cols[iCat] || "").trim();
    if (!name || !categoryName) continue;
    const price = Number((cols[iPrice] || "").trim());
    if (!Number.isInteger(price) || price < 0) {
      console.warn(`skip invalid price line ${li + 1}: ${name}`);
      continue;
    }
    const extPid = iPid >= 0 ? (cols[iPid] || "").trim() : "";
    const priceTaxMode = parseTaxMode(cols[iTax] || "");
    let taxRate: number | null = null;
    if (iRate >= 0 && cols[iRate] !== undefined) {
      const r = Number(String(cols[iRate]).trim());
      if (Number.isFinite(r)) taxRate = Math.round(r);
    }
    if (taxRate != null) taxRates.add(taxRate);
    rows.push({ name, extPid, categoryName, price, priceTaxMode, taxRate });
  }

  if (taxRates.size === 1) {
    const [only] = [...taxRates];
    const st = mergeStoreSettings(store.settings);
    st.taxRatePercent = only;
    await prisma.store.update({
      where: { id: storeId },
      data: { settings: st as object },
    });
    console.log(`Updated store taxRatePercent to ${only}%`);
  } else if (taxRates.size > 1) {
    console.warn("Multiple tax rates in CSV; store taxRatePercent not changed.");
  }

  const categoryOrder: string[] = [];
  const seenCat = new Set<string>();
  for (const r of rows) {
    if (!seenCat.has(r.categoryName)) {
      seenCat.add(r.categoryName);
      categoryOrder.push(r.categoryName);
    }
  }

  await prisma.$transaction(
    async (tx) => {
    if (!merge) {
      await tx.menuItem.deleteMany({ where: { category: { storeId } } });
      await tx.menuCategory.deleteMany({ where: { storeId } });
    }

    const catIdByName = new Map<string, string>();
    let sort = 0;
    for (const catName of categoryOrder) {
      const catId = stableId("csvcat", [storeId, catName]);
      catIdByName.set(catName, catId);
      await tx.menuCategory.upsert({
        where: { id: catId },
        create: {
          id: catId,
          storeId,
          name: catName,
          sortOrder: sort++,
          visibleToGuest: true,
        },
        update: { name: catName, sortOrder: sort - 1, visibleToGuest: true },
      });
    }

    const perCatIndex = new Map<string, number>();
    for (const r of rows) {
      const catId = catIdByName.get(r.categoryName);
      if (!catId) continue;
      const itemId = pickItemId(storeId, r.categoryName, r.name, r.extPid);
      const si = perCatIndex.get(catId) ?? 0;
      perCatIndex.set(catId, si + 1);
      await tx.menuItem.upsert({
        where: { id: itemId },
        create: {
          id: itemId,
          categoryId: catId,
          name: r.name,
          price: r.price,
          priceTaxMode: r.priceTaxMode,
          sortOrder: si,
          isAvailable: true,
        },
        update: {
          categoryId: catId,
          name: r.name,
          price: r.price,
          priceTaxMode: r.priceTaxMode,
          sortOrder: si,
          isAvailable: true,
        },
      });
    }
  },
  { timeout: 180_000, maxWait: 60_000 }
  );

  console.log(`Done. store=${storeId} categories=${categoryOrder.length} items=${rows.length} merge=${merge}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
