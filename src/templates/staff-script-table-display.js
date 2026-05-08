/** Shorten store-prefixed table publicCode for display (e.g. C01). Keep in sync with src/lib/table-display-code.ts */
function displayTableCode(raw) {
  const raw0 = String(raw || "").trim();
  if (!raw0) return "";
  const u = raw0.toUpperCase();
  const m = u.match(/(?:^|[^A-Z0-9])(C|T)0*(\d+)\s*$/);
  if (m) {
    const kind = String(m[1]).toUpperCase();
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n)) return kind + String(n).padStart(2, "0");
  }
  if (/^\d+$/.test(u)) {
    const n = parseInt(u, 10);
    if (n >= 1 && n <= 10) return "C" + String(n).padStart(2, "0");
    if (n >= 21) return "T" + String(n).padStart(2, "0");
  }
  return raw0;
}
