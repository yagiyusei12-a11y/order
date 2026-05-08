/**
 * Staff / guest-facing short labels for table publicCode (e.g. C01, T09).
 * Does not replace stored publicCode or URLs — display only.
 */
export function displayTableCode(raw: string | null | undefined): string {
  const raw0 = String(raw ?? "").trim();
  if (!raw0) return "";
  const upper = raw0.toUpperCase();

  const m = upper.match(/(?:^|[^A-Z0-9])(C|T)0*(\d+)\s*$/);
  if (m) {
    const kind = String(m[1]).toUpperCase();
    const n = parseInt(String(m[2]), 10);
    if (Number.isFinite(n)) return kind + String(n).padStart(2, "0");
  }

  if (/^\d+$/.test(upper)) {
    const n = parseInt(upper, 10);
    if (n >= 1 && n <= 10) return "C" + String(n).padStart(2, "0");
    if (n >= 21) return "T" + String(n).padStart(2, "0");
  }

  return raw0;
}

/** Prefer human table name; if missing or same as publicCode, use short display code. */
export function tableDisplayLabel(
  name: string | null | undefined,
  publicCode: string | null | undefined,
): string {
  const n = String(name ?? "").trim();
  const pc = String(publicCode ?? "").trim();
  const shortPc = pc ? displayTableCode(pc) : "";
  if (!n) return shortPc;
  if (pc && n === pc) return shortPc || n;
  if (pc && n.toLowerCase() === pc.toLowerCase()) return shortPc || n;
  return n;
}
