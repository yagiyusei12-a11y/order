import { readFileSync } from "node:fs";
import QRCode from "qrcode";
import { prisma } from "../db.js";
import { templatePath } from "./paths.js";
import { customerFacingStoreName, mergeStoreSettings } from "./store-settings.js";
import { tableDisplayLabel } from "./table-display-code.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PER_PAGE = 9;
const LEAD = "こちらからご注文ください";
const TAIL = "お帰りの際はこちらをレジまでお持ちください";

type SeatPrintRow = {
  name: string;
  publicCode: string;
  url: string;
  qrSvg: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function renderSeatCell(seat: SeatPrintRow | null): string {
  if (!seat) return `<div class="seat-cell is-empty" aria-hidden="true"></div>`;
  return (
    `<div class="seat-cell">` +
    `<div>` +
    `<p class="seat-lead">${escapeHtml(LEAD)}</p>` +
    `<p class="seat-name">${escapeHtml(seat.name)}</p>` +
    `</div>` +
    `<div class="seat-qr">${seat.qrSvg}</div>` +
    `<p class="seat-tail">${escapeHtml(TAIL)}</p>` +
    `</div>`
  );
}

function renderSheet(pageSeats: (SeatPrintRow | null)[]): string {
  const cells = pageSeats.map(renderSeatCell).join("");
  return `<div class="a4-sheet">${cells}</div>`;
}

/**
 * 席マスタ全席（有効のみ）の卓QRを A4・1枚9席で並べた印刷用 HTML。
 * origin はリバースプロキシ経由の公開オリジン（QR の絶対 URL 用）。
 */
export async function buildTableQrPrintHtml(
  storeId: string,
  origin: string,
): Promise<string | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return null;

  const settings = mergeStoreSettings(store.settings);
  const storeName = customerFacingStoreName(store.name, settings);

  const tables = await prisma.table.findMany({
    where: { storeId: store.id, active: true },
    orderBy: { sortOrder: "asc" },
  });

  const base = origin.replace(/\/$/, "");
  const seats: SeatPrintRow[] = [];
  for (const t of tables) {
    const url = `${base}/table-app/${encodeURIComponent(t.publicCode)}`;
    const qrSvg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1d24ff", light: "#ffffffff" },
    });
    seats.push({
      name: tableDisplayLabel(t.name, t.publicCode) || t.name,
      publicCode: t.publicCode,
      url,
      qrSvg,
    });
  }

  let tpl = readFileSync(templatePath("table-qr-print.html"), "utf8");
  const generatedAt = new Date().toLocaleString("ja-JP", { hour12: false });

  if (seats.length === 0) {
    const sheets =
      `<p class="empty-msg">印刷できる有効な席がありません。席マスタで席を追加・有効化してください。</p>`;
    return tpl
      .replace(/__STORE_NAME__/g, escapeHtml(storeName))
      .replace(
        /__TOOLBAR_NOTE__/g,
        escapeHtml(`${storeName} · 席QR · 有効な席 0 件 · ${generatedAt}`),
      )
      .replace(/__SHEETS__/g, sheets);
  }

  const pages = chunk(seats, PER_PAGE).map((page) => {
    const padded: (SeatPrintRow | null)[] = [...page];
    while (padded.length < PER_PAGE) padded.push(null);
    return renderSheet(padded);
  });

  const toolbar = `${storeName} · 席QR印刷 · 有効 ${seats.length} 席 · A4×${pages.length}枚（1枚9席） · ${generatedAt}　｜　印刷ダイアログから「PDFに保存」も可`;

  return tpl
    .replace(/__STORE_NAME__/g, escapeHtml(storeName))
    .replace(/__TOOLBAR_NOTE__/g, escapeHtml(toolbar))
    .replace(/__SHEETS__/g, `<div class="sheet-stack">${pages.join("")}</div>`);
}
