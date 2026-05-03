/**
 * 店舗 harunoyukoto に卓（席）を投入する。
 * 実行: npx tsx prisma/seed-harunoyukoto-tables.ts（プロジェクト直下の .env を読む）
 *
 * publicCode はアプリ全体で一意のため `harunoyukoto-<席名小文字>`（例: harunoyukoto-c01）
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/** dotenv 無しで DATABASE_URL などを読む（VPS の `cd ~/order && npx tsx ...` 用） */
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
const STORE_ID = "harunoyukoto";

function seatLabels(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 10; i++) out.push(`C${String(i).padStart(2, "0")}`);
  for (let i = 21; i <= 24; i++) out.push(`T${i}`);
  for (let i = 31; i <= 37; i++) out.push(`T${i}`);
  for (let i = 52; i <= 54; i++) out.push(`T${i}`);
  for (let i = 61; i <= 64; i++) out.push(`T${i}`);
  return out;
}

async function main() {
  let store = await prisma.store.findUnique({ where: { id: STORE_ID } });
  if (!store) {
    store = await prisma.store.create({
      data: { id: STORE_ID, name: "はるのゆこと", settings: {} },
    });
    console.log("Created store:", store.id);
  }

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
      update: {
        name,
        sortOrder: i + 1,
        active: true,
      },
    });
  }

  console.log(`OK: ${labels.length} tables for ${STORE_ID} (${labels[0]} … ${labels[labels.length - 1]})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
