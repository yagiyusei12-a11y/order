import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "src/templates/guest.html");
let s = readFileSync(path, "utf8");
if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

const nl = s.includes("\r\n") ? "\r\n" : "\n";

if (!s.includes("function guestSetStepUserPickCount")) {
  const insert =
    `${nl}    function guestSetStepUserPickCount(st, menuItemIds) {${nl}` +
    `      const fixedSet = new Set((st.fixedChoices || []).map((c) => String(c.menuItemId)));${nl}` +
    `      return (menuItemIds || []).filter((id) => !fixedSet.has(String(id))).length;${nl}` +
    `    }${nl}${nl}`;
  const marker = `    function guestValidateSetComponentOptions(st, rootEl) {`;
  if (!s.includes(marker)) throw new Error("helper insert marker missing");
  s = s.replace(marker, insert + marker);
}

const collectOld =
  `        const ids = stepEl${nl}          ? [...stepEl.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value)${nl}          : [];`;
const collectNew =
  `        const ids = stepEl${nl}          ? [...stepEl.querySelectorAll("input[type=checkbox][name^=\\"p-\\"]:checked")].map((x) => x.value)${nl}          : [];`;
if (!s.includes(collectNew)) {
  if (!s.includes(collectOld)) throw new Error("collectSetSelections block missing");
  s = s.replace(collectOld, collectNew);
}

const nOld = `            const n = sel && sel.menuItemIds ? sel.menuItemIds.length : 0;${nl}            if (!guestValidateSetStepPickCount(st, n))`;
const nNew = `            const n = guestSetStepUserPickCount(st, sel && sel.menuItemIds ? sel.menuItemIds : []);${nl}            if (!guestValidateSetStepPickCount(st, n))`;
if (!s.includes(nNew)) {
  const count = (s.match(/const n = sel && sel\.menuItemIds \? sel\.menuItemIds\.length : 0;/g) || []).length;
  if (count < 2) throw new Error(`expected 2 n= replacements, found ${count}`);
  s = s.split(nOld).join(nNew);
}

if (!s.includes("function guestSetStepUserPickCount")) throw new Error("helper missing");
if (!s.includes('input[type=checkbox][name^=\\"p-\\"]:checked')) throw new Error("p- filter missing");

writeFileSync(path, s, "utf8");
console.log("patched guest.html OK");
