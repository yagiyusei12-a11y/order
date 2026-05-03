/* eslint-disable no-console */
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

async function cols(table: string): Promise<string[]> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) throw new Error("invalid table");
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
  );
  return rows.map((r) => r.column_name);
}

async function main() {
  console.log("MenuCategory:", (await cols("MenuCategory")).join(", "));
  console.log("MenuItem:", (await cols("MenuItem")).join(", "));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
