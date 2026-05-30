// Idempotent one-shot setup for harunoyukoto net reservation / reception merge rules.
// Run on VPS (production DB) after deploy:
//   node scripts/setup-harunoyukoto-net-settings.js
//
// This script ONLY updates Table.mergeWith for storeId=harunoyukoto,
// and stores merge constraints into ReceptionConfig.data.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normLabelFromPublicCode(code) {
  const raw = String(code || "").trim().toUpperCase();
  // Accept "HARUNOYUKOTO-C01" / "HARUNOYUKOTO-T31" / "C01" / "T31"
  const m = raw.match(/(?:^|[^A-Z0-9])(C|T)0*(\d+)\s*$/i);
  if (m) return String(m[1]).toUpperCase() + String(parseInt(m[2], 10));
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 10) return "C" + n;
    if (n >= 21) return "T" + n;
  }
  return raw;
}

function buildAdjMerge(labels) {
  // labels: ["C1","C2",...]
  const out = new Map();
  for (const l of labels) out.set(l, []);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    const arr = [];
    if (i - 1 >= 0) arr.push(labels[i - 1]);
    if (i + 1 < labels.length) arr.push(labels[i + 1]);
    out.set(l, arr);
  }
  return out;
}

async function main() {
  const storeId = "harunoyukoto";
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw new Error(`store not found: ${storeId}`);

  const tables = await prisma.table.findMany({
    where: { storeId, active: true },
    select: { id: true, publicCode: true, mergeWith: true },
  });
  if (!tables.length) throw new Error("no tables found for store");

  // map label -> actual publicCode (e.g. "C1" -> "harunoyukoto-c01")
  const labelToCode = new Map();
  for (const t of tables) {
    const label = normLabelFromPublicCode(t.publicCode);
    if (!label) continue;
    // prefer longer (prefixed) publicCode if duplicates ever exist
    const prev = labelToCode.get(label);
    if (!prev || String(t.publicCode).length > String(prev).length) labelToCode.set(label, t.publicCode);
  }

  // Define merge rules by labels (user requirement)
  const rules = new Map();

  // C01-C10: adjacent merge, up to 10 (graph adjacency is enough)
  for (const [k, v] of buildAdjMerge(Array.from({ length: 10 }, (_, i) => `C${i + 1}`))) rules.set(k, v);

  // T21-T24: 21<->22, 23<->24
  rules.set("T21", ["T22"]);
  rules.set("T22", ["T21"]);
  rules.set("T23", ["T24"]);
  rules.set("T24", ["T23"]);

  // T32-T37 adjacent (max 6)
  for (const [k, v] of buildAdjMerge(Array.from({ length: 6 }, (_, i) => `T${32 + i}`))) rules.set(k, v);

  // T52-T54 adjacent (max 3)
  for (const [k, v] of buildAdjMerge(["T52", "T53", "T54"])) rules.set(k, v);

  // T61-T64 adjacent (max 4)
  for (const [k, v] of buildAdjMerge(["T61", "T62", "T63", "T64"])) rules.set(k, v);

  // Apply mergeWith updates (store-prefixed codes)
  const updates = [];
  for (const [label, neighborLabels] of rules.entries()) {
    const code = labelToCode.get(label);
    if (!code) continue;
    const neighborCodes = neighborLabels.map((l) => labelToCode.get(l)).filter(Boolean);
    updates.push({ code, neighborCodes });
  }

  // Keep other seats' mergeWith as-is; only overwrite for seats we know.
  for (const u of updates) {
    await prisma.table.update({
      where: { publicCode: u.code },
      data: { mergeWith: u.neighborCodes },
    });
  }

  // mergeAllOrNothingGroups は「1つでも使うならグループ全卓」かつ席は mergeWith 上で連結している必要がある。
  // T52–54 と T61–64 は島が分かれているため [全卓一括] にすると自動席割りが常に不可能になる。
  // 貸し切りは手動で席を選ぶ運用とし、ここでは空にする（ネット予約はサーバ側で AON を無視済み）。

  // Store constraints into ReceptionConfig.data (merged)
  const prevConf = await prisma.receptionConfig.findUnique({ where: { storeId } });
  const prevData =
    prevConf?.data && typeof prevConf.data === "object" && !Array.isArray(prevConf.data)
      ? prevConf.data
      : {};
  await prisma.receptionConfig.upsert({
    where: { storeId },
    create: {
      storeId,
      data: {
        staff: 6,
        override: false,
        manualWait: 30,
        maxMergeSize: 10,
        mergeAllOrNothingGroups: [],
        netReserveSeatTypeMode: "any",
        receptionGuestSeatTypePriority: ["半個室", "掘りごたつ", "カウンター"],
      },
    },
    update: {
      data: {
        ...prevData,
        maxMergeSize: 10,
        mergeAllOrNothingGroups: [],
        netReserveSeatTypeMode: "any",
        receptionGuestSeatTypePriority: Array.isArray(prevData.receptionGuestSeatTypePriority)
          ? prevData.receptionGuestSeatTypePriority
          : ["半個室", "掘りごたつ", "カウンター"],
      },
    },
  });

  console.log(JSON.stringify({ ok: true, updated: updates.length, mergeAllOrNothingGroups: [] }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

