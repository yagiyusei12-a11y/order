/**
 * 外部POS「取引詳細」CSV → 店舗 harunoyukoto に精算済み Bill + Payment を投入（伝票単位・明細なし）
 *
 * 前提: DATABASE_URL（.env）が対象DBを指すこと。
 *
 *   npx tsx prisma/import-harunoyukoto-transactions-csv.ts --file "path/to.csv" [--dry-run]
 *
 * --dry-run: DBへ書き込まず件数・不一致行のみ表示
 *
 * 会計割引: `Bill.discountJson` が無いDB（マイグレーション未適用）でも動くよう、
 * 割引額は `label` に `|d{円}` で埋め込む（例: import:123|A|d500）。列がある環境でも同様。
 *
 * Bill / Payment とも Prisma の `create()` は使わない。クライアントがスキーマ上の列（例:
 * `Bill.discountJson`, `Payment.voidedAt`）を INSERT に含め、DB が古いと失敗するため。
 * 初期マイグレーション相当の列だけを raw INSERT する。
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const STORE_ID = "harunoyukoto";
/** seed に店舗が無い環境でもインポートできるよう、存在しなければ作成する */
const STORE_NAME_DEFAULT = "はるのゆこと 長浜店";

const EXTRA_PAYMENT_METHODS: { code: string; labelJa: string; sortOrder: number }[] = [
  { code: "funfo", labelJa: "Funfo", sortOrder: 25 },
  { code: "stera_pack", labelJa: "stera pack", sortOrder: 26 },
  { code: "mo_settlement", labelJa: "MO決済", sortOrder: 27 },
];

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

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** JST として解釈し UTC の Date に（長浜店想定） */
function parseJpDateTime(s: string): Date | null {
  const t = stripBom(s).trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mm = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+09:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseIntCell(raw: string): number | null {
  const s = stripBom(raw).replace(/,/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseArgs(): { file: string; dryRun: boolean } {
  const argv = process.argv.slice(2);
  let file = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--file" && argv[i + 1]) {
      file = argv[++i];
      continue;
    }
    if (!a.startsWith("-") && !file) {
      file = a;
    }
  }
  return { file, dryRun };
}

type PayRow = { methodCode: string; amount: number };

function buildPaymentsFromRow(
  cells: string[],
  idx: Map<string, number>,
): { payments: PayRow[]; sum: number } {
  const payments: PayRow[] = [];

  const cashTendered = idx.has("現金") ? parseIntCell(cells[idx.get("現金")!] ?? "") : null;
  const change = idx.has("お釣り") ? parseIntCell(cells[idx.get("お釣り")!] ?? "") ?? 0 : 0;
  if (cashTendered != null && cashTendered > 0) {
    const net = cashTendered - Math.max(0, change);
    if (net > 0) payments.push({ methodCode: "cash", amount: net });
  }

  let funfo = idx.has("Funfo") ? parseIntCell(cells[idx.get("Funfo")!] ?? "") : null;

  const steraCol =
    idx.get("stera pack") ??
    idx.get("stera pack".trim()) ??
    [...idx.entries()].find(([k]) => k.toLowerCase().includes("stera"))?.[1];
  let stera =
    steraCol != null ? parseIntCell(cells[steraCol] ?? "") : null;

  let mo = idx.has("MO決済") ? parseIntCell(cells[idx.get("MO決済")!] ?? "") : null;

  /** CSVで MO決済 と Funfo／stera が同一金額の二重出力になる行があるため、MO を優先して片方だけ採用 */
  if (mo != null && mo > 0) {
    if (funfo === mo) funfo = null;
    if (stera === mo) stera = null;
  }

  if (funfo != null && funfo > 0) payments.push({ methodCode: "funfo", amount: funfo });
  if (stera != null && stera > 0) payments.push({ methodCode: "stera_pack", amount: stera });
  if (mo != null && mo > 0) payments.push({ methodCode: "mo_settlement", amount: mo });

  const sum = payments.reduce((s, p) => s + p.amount, 0);
  return { payments, sum };
}

loadDotEnv();
const prisma = new PrismaClient();

async function ensureStore(): Promise<void> {
  const existing = await prisma.store.findUnique({
    where: { id: STORE_ID },
    select: { id: true },
  });
  if (existing) return;
  await prisma.store.create({
    data: {
      id: STORE_ID,
      name: STORE_NAME_DEFAULT,
      settings: {},
    },
  });
  console.log(`Created store ${STORE_ID} (${STORE_NAME_DEFAULT})`);
}

async function ensurePaymentMethods(): Promise<void> {
  await ensureStore();

  const defs = [
    { code: "cash", labelJa: "現金", sortOrder: 10 },
    ...EXTRA_PAYMENT_METHODS,
  ];
  for (const m of defs) {
    await prisma.paymentMethodDefinition.upsert({
      where: { code: m.code },
      create: m,
      update: { labelJa: m.labelJa, sortOrder: m.sortOrder },
    });
  }

  const allCodes = [...new Set(defs.map((d) => d.code))];
  for (let i = 0; i < allCodes.length; i++) {
    const code = allCodes[i];
    const def = await prisma.paymentMethodDefinition.findUnique({ where: { code } });
    if (!def) continue;
    await prisma.storePaymentMethod.upsert({
      where: {
        storeId_definitionId: { storeId: STORE_ID, definitionId: def.id },
      },
      create: {
        storeId: STORE_ID,
        definitionId: def.id,
        enabled: true,
        sortOrder: 10 + i,
      },
      update: { enabled: true },
    });
  }
}

async function main(): Promise<void> {
  const { file, dryRun } = parseArgs();
  if (!file) {
    console.error(
      "Usage: npx tsx prisma/import-harunoyukoto-transactions-csv.ts --file <path.csv> [--dry-run]",
    );
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error("File not found:", file);
    process.exit(1);
  }

  const raw = readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    console.error("CSV empty");
    process.exit(1);
  }

  const headerCells = parseCsvLine(lines[0]).map((h) => stripBom(h.trim()));
  const idx = new Map<string, number>();
  headerCells.forEach((h, i) => idx.set(h, i));

  const required = ["伝票番号", "合計金額", "退店時間"];
  for (const k of required) {
    if (!idx.has(k)) {
      console.error("Missing column:", k, "headers:", headerCells.join(", "));
      process.exit(1);
    }
  }

  if (!dryRun) {
    await ensurePaymentMethods();
  }

  let imported = 0;
  let skipped = 0;
  let skippedMismatch = 0;
  let skippedDup = 0;
  let skippedAggregate = 0;

  // lines[0]=ヘッダ, lines[1]=集計行 → i>=2 からが伝票行
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const cells = parseCsvLine(line);
    if (cells.length < headerCells.length) {
      while (cells.length < headerCells.length) cells.push("");
    }

    const ticketNo = (cells[idx.get("伝票番号")!] ?? "").trim();
    const totalRaw = cells[idx.get("合計金額")!] ?? "";
    const totalAmount = parseIntCell(totalRaw);

    if (!ticketNo || totalAmount == null) {
      skippedAggregate++;
      continue;
    }

    if (totalAmount <= 0) {
      skipped++;
      continue;
    }

    const ticketSymbol = (cells[idx.get("伝票記号")!] ?? "").trim();

    const enterIdx = idx.get("入店時間");
    const exitIdx = idx.get("退店時間");
    const genIdx = idx.get("データ生成日時");
    const enterAt =
      enterIdx != null ? parseJpDateTime(cells[enterIdx] ?? "") : null;
    const exitAt =
      exitIdx != null ? parseJpDateTime(cells[exitIdx] ?? "") : null;
    const genAt =
      genIdx != null ? parseJpDateTime(cells[genIdx] ?? "") : null;
    const settledAt = exitAt ?? genAt ?? enterAt ?? new Date();
    const createdAt = enterAt ?? settledAt;

    const discIdx = idx.get("会計割引");
    const discRaw = discIdx != null ? parseIntCell(cells[discIdx] ?? "") : null;
    /** 冪等キー。会計割引ありは `|d{abs}` を付与（discountJson 列が無いDBでも保持） */
    const label =
      `import:${ticketNo}|${ticketSymbol || "-"}` +
      (discRaw != null && discRaw !== 0 ? `|d${Math.abs(discRaw)}` : "");

    const { payments, sum } = buildPaymentsFromRow(cells, idx);
    if (sum !== totalAmount) {
      console.warn(
        `[skip mismatch] line ${lineNo} 伝票 ${ticketNo} total=${totalAmount} paymentsSum=${sum} label=${label}`,
      );
      skippedMismatch++;
      continue;
    }
    if (payments.length === 0) {
      console.warn(`[skip no payments] line ${lineNo} 伝票 ${ticketNo}`);
      skippedMismatch++;
      continue;
    }

    if (dryRun) {
      imported++;
      continue;
    }

    const existing = await prisma.bill.findFirst({
      where: { storeId: STORE_ID, label },
      select: { id: true },
    });
    if (existing) {
      skippedDup++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const billId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "Bill" ("id", "storeId", "sessionId", "label", "totalAmount", "status", "createdAt", "settledAt")
        VALUES (${billId}, ${STORE_ID}, NULL, ${label}, ${totalAmount}, ${"settled"}, ${createdAt}, ${settledAt})
      `;
      const payNote = `CSV取引詳細 ${ticketNo}`;
      for (const p of payments) {
        const paymentId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "Payment" ("id", "billId", "methodCode", "amount", "note")
          VALUES (${paymentId}, ${billId}, ${p.methodCode}, ${p.amount}, ${payNote})
        `;
      }
    });
    imported++;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        imported,
        skippedZeroOrInvalid: skipped,
        skippedAggregateRows: skippedAggregate,
        skippedPaymentMismatch: skippedMismatch,
        skippedDuplicateLabel: skippedDup,
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
