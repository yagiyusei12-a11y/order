/**
 * 外部POS「取引詳細」CSV → 店舗 harunoyukoto に精算済み Bill + Payment を投入（伝票単位・明細なし）
 *
 * 前提: DATABASE_URL（.env）が対象DBを指すこと。
 *
 *   npx tsx prisma/import-harunoyukoto-transactions-csv.ts --file "path/to.csv" [--dry-run]
 *
 * --dry-run: DBへ書き込まず件数・不一致行のみ表示
 *
 * 合計0円の伝票も取り込む。支払列の合計と「合計金額」がずれる行は、合計金額に合わせて支払内訳を円単位に按分する（警告ログ付き）。
 *
 * 会計割引: CSV の「会計割引」列を `Bill.discountJson` に保存（kind=yen, value=円）。
 * 冪等キー用に `label` にも `|d{円}` を付与（例: import:123|A|d500）。
 *
 * Bill / Payment は Prisma の `create()` を使わず raw INSERT（Payment は voidedAt を含めない）。
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const STORE_ID = "harunoyukoto";
/** seed に店舗が無い環境でもインポートできるよう、存在しなければ作成する */
const STORE_NAME_DEFAULT = "はるのゆこと 長浜店";

const EXTRA_PAYMENT_METHODS: { code: string; labelJa: string; sortOrder: number }[] = [
  { code: "funfo", labelJa: "Funfo", sortOrder: 25 },
  { code: "stera_pack", labelJa: "stera pack", sortOrder: 26 },
  { code: "mo_settlement", labelJa: "MO決済", sortOrder: 27 },
];

/** 長時間無音にならないよう、投入（または dry-run の試算）件数をこの間隔で表示 */
const PROGRESS_LOG_EVERY = 100;

/** 重複スキップなどで新規投入が増えなくても、CSV を読んでいることが分かるよう走査行ごとに表示 */
const ROW_SCAN_LOG_EVERY = 500;

function logImportProgress(imported: number, dryRun: boolean): void {
  if (imported > 0 && imported % PROGRESS_LOG_EVERY === 0) {
    const mode = dryRun ? "dry-run " : "";
    console.log(`[harunoyukoto-sales] ${mode}進捗: ${imported} 伝票`);
  }
}

function logRowScanProgress(
  completedDataRows: number,
  imported: number,
  skippedDup: number,
  skippedMismatch: number,
  dryRun: boolean,
): void {
  if (completedDataRows <= 0 || completedDataRows % ROW_SCAN_LOG_EVERY !== 0) return;
  const mode = dryRun ? "dry-run " : "";
  console.log(
    `[harunoyukoto-sales] ${mode}CSV ${completedDataRows} 行処理済み（新規投入 ${imported} / 重複スキップ ${skippedDup} / 支払不一致 ${skippedMismatch}）`,
  );
}

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

/**
 * CSV の支払列合計と「合計金額」が一致しない行（端数・POS と CSV のズレ）を、合計金額を正として支払内訳に按分する。
 */
function allocatePaymentsToTotal(payments: PayRow[], totalAmount: number): PayRow[] {
  if (payments.length === 0 || totalAmount <= 0) return [];
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  if (sum <= 0) return [];
  if (sum === totalAmount) return payments.map((p) => ({ ...p }));

  const scaled = payments.map((p) => ({
    methodCode: p.methodCode,
    frac: (p.amount * totalAmount) / sum,
  }));
  const floors = scaled.map((x) => Math.floor(x.frac));
  let remainder = totalAmount - floors.reduce((a, b) => a + b, 0);
  const idxByFrac = [...scaled.keys()].sort((a, b) => {
    const fa = scaled[a].frac - floors[a];
    const fb = scaled[b].frac - floors[b];
    return fb - fa;
  });
  const out = floors.map((amt, i) => ({
    methodCode: scaled[i].methodCode,
    amount: amt,
  }));
  for (const j of idxByFrac) {
    if (remainder <= 0) break;
    out[j].amount++;
    remainder--;
  }
  return out.filter((p) => p.amount > 0);
}

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

  console.log(
    `[harunoyukoto-sales] 伝票データ行 ${lines.length - 2} 件を処理します${dryRun ? "（dry-run）" : ""}…`,
  );

  let imported = 0;
  let skippedMismatch = 0;
  let skippedDup = 0;
  let skippedAggregate = 0;
  let skippedNegativeTotal = 0;
  let paymentScaledToTotal = 0;

  // lines[0]=ヘッダ, lines[1]=集計行 → i>=2 からが伝票行
  for (let i = 2; i < lines.length; i++) {
    const completedDataRows = i - 2;
    if (completedDataRows > 0 && completedDataRows % ROW_SCAN_LOG_EVERY === 0) {
      logRowScanProgress(completedDataRows, imported, skippedDup, skippedMismatch, dryRun);
    }

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

    if (totalAmount < 0) {
      skippedNegativeTotal++;
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
    const hasAccountingDiscount = discRaw != null && discRaw !== 0;
    /** 冪等キー。会計割引ありは `|d{abs}` を付与 */
    const label =
      `import:${ticketNo}|${ticketSymbol || "-"}` +
      (hasAccountingDiscount ? `|d${Math.abs(discRaw!)}` : "");
    /** レポート「割引」一覧用（parseBillDiscount と同一形） */
    const discountJsonParam: Prisma.InputJsonValue | typeof Prisma.DbNull = hasAccountingDiscount
      ? {
          kind: "yen",
          value: Math.abs(discRaw!),
          label: "外部POS会計割引",
        }
      : Prisma.DbNull;

    let payments = buildPaymentsFromRow(cells, idx).payments;
    let sum = payments.reduce((s, p) => s + p.amount, 0);

    if (totalAmount === 0) {
      if (sum !== 0) {
        console.warn(
          `[skip mismatch] line ${lineNo} 伝票 ${ticketNo} total=0 but paymentsSum=${sum} label=${label}`,
        );
        skippedMismatch++;
        continue;
      }
      payments = [];
    } else if (payments.length === 0) {
      console.warn(`[skip no payments] line ${lineNo} 伝票 ${ticketNo}`);
      skippedMismatch++;
      continue;
    } else if (sum !== totalAmount) {
      if (sum <= 0) {
        console.warn(
          `[skip mismatch] line ${lineNo} 伝票 ${ticketNo} total=${totalAmount} paymentsSum=${sum} label=${label}`,
        );
        skippedMismatch++;
        continue;
      }
      const scaled = allocatePaymentsToTotal(payments, totalAmount);
      if (!scaled.length) {
        console.warn(
          `[skip mismatch] line ${lineNo} 伝票 ${ticketNo} could not allocate payments to total=${totalAmount} label=${label}`,
        );
        skippedMismatch++;
        continue;
      }
      paymentScaledToTotal++;
      console.warn(
        `[payments scaled] line ${lineNo} 伝票 ${ticketNo} total=${totalAmount} csvPaymentsSum=${sum} -> allocated=${scaled.reduce((a, p) => a + p.amount, 0)}`,
      );
      payments = scaled;
    }

    if (dryRun) {
      imported++;
      logImportProgress(imported, true);
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
        INSERT INTO "Bill" ("id", "storeId", "sessionId", "label", "discountJson", "totalAmount", "status", "createdAt", "settledAt")
        VALUES (${billId}, ${STORE_ID}, NULL, ${label}, ${discountJsonParam}, ${totalAmount}, ${"settled"}, ${createdAt}, ${settledAt})
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
    logImportProgress(imported, false);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        imported,
        skippedNegativeTotal,
        skippedAggregateRows: skippedAggregate,
        skippedPaymentMismatch: skippedMismatch,
        skippedDuplicateLabel: skippedDup,
        paymentScaledToMatchTotal: paymentScaledToTotal,
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
