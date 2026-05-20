import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "src/templates/guest.html");
let s = readFileSync(path, "utf8");
if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
const marker = "<!-- guest-ui-build:";
if (s.includes(marker)) {
  s = s.replace(/<!-- guest-ui-build:[^>]+-->\r?\n/, "");
}
const nl = s.includes("\r\n") ? "\r\n" : "\n";
s = s.replace("<!DOCTYPE html>" + nl, "<!DOCTYPE html>" + nl + "<!-- guest-ui-build: 20260520-utf8-fix -->" + nl);
writeFileSync(path, s, "utf8");
console.log("added build comment");
