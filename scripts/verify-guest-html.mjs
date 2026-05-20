import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "src/templates/guest.html");
const s = readFileSync(path, "utf8");
const badQ = (s.match(/\?\?\?\?/g) || []).length;
const checks = [
  ["title", s.includes("<title>ご注文</title>")],
  ["hdr", s.includes('let hdr = "人数 ')],
  ["pick fix", s.includes("guestSetStepUserPickCount")],
  ["no ????", badQ === 0],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? "OK" : "FAIL", name);
  if (!pass) ok = false;
}
if (badQ) console.log("???? count", badQ);
process.exit(ok ? 0 : 1);
