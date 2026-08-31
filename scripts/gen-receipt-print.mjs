import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** 印刷ロジックは staff-script-receipt-print.js が正本。再生成は通常不要。 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = join(root, "src/templates/staff-script-receipt-print.js");
const outPath = srcPath;

const s = readFileSync(srcPath, "utf8");
if (!s.includes("StaffReceiptPrint")) {
  throw new Error("staff-script-receipt-print.js が見つからないか形式が不正です");
}
writeFileSync(outPath, s, "utf8");
console.log("No-op: maintain", outPath, "directly");
