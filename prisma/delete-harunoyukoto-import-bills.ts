/**
 * 店舗 harunoyukoto の「外部POS CSV 取込」伝票だけ削除する（label が import: で始まる Bill）。
 * Payment は FK CASCADE で連鎖削除される。
 *
 *   npx tsx prisma/delete-harunoyukoto-import-bills.ts           # 件数のみ表示（削除しない）
 *   npx tsx prisma/delete-harunoyukoto-import-bills.ts --execute # 削除実行
 *
 * 前提: DATABASE_URL（.env）が対象DBを指すこと。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const STORE_ID = "harunoyukoto";

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

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");

  const where = {
    storeId: STORE_ID,
    label: { startsWith: "import:" as const },
  };

  const count = await prisma.bill.count({ where });

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          storeId: STORE_ID,
          matchingBills: count,
          hint: "削除するには同じコマンドに --execute を付けて再実行してください。",
        },
        null,
        2,
      ),
    );
    return;
  }

  const deleted = await prisma.bill.deleteMany({ where });
  console.log(
    JSON.stringify(
      {
        storeId: STORE_ID,
        deletedBills: deleted.count,
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
