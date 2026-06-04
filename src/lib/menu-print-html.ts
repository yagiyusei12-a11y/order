import { readFileSync } from "node:fs";
import { prisma } from "../db.js";
import { baseNetFromStoredPrice, taxIncludedFromNet } from "./order-line-tax.js";
import { templatePath } from "./paths.js";
import { customerFacingStoreName, mergeStoreSettings } from "./store-settings.js";

type MenuChapterKind = "food" | "drink" | "teishoku";

type MenuItemRow = {
  name: string;
  priceNet: number;
  priceIncl: number;
};

type MenuSubCategory = {
  name: string;
  items: MenuItemRow[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatYen(n: number): string {
  return "¥" + Math.max(0, Math.round(n)).toLocaleString("ja-JP");
}

function menuItemNetAndIncl(
  storedPrice: number,
  priceTaxMode: string,
  defaultMode: "inclusive" | "exclusive",
  taxRatePercent: number,
): { net: number; incl: number } {
  const mode = priceTaxMode === "exclusive" ? "exclusive" : defaultMode;
  const net = baseNetFromStoredPrice(storedPrice, mode, taxRatePercent);
  const incl = taxIncludedFromNet(net, taxRatePercent);
  return { net, incl };
}

/** カテゴリ名から印刷用の大区分（料理 / ドリンク / 定食）を判定 */
export function classifyMenuPrintChapter(categoryName: string): MenuChapterKind {
  const n = String(categoryName ?? "")
    .trim()
    .normalize("NFKC");
  if (/丼定食|ランチ|定食/.test(n)) return "teishoku";
  if (/ビール|焼酎|日本酒|ハイボール|サワー|ソフト|ドリンク|ハッピーアワー|半額/.test(n)) return "drink";
  return "food";
}

const CHAPTER_META: Record<
  MenuChapterKind,
  { ja: string; en: string; lead: string }
> = {
  food: {
    ja: "料　理",
    en: "FOOD",
    lead: "おつまみ・揚物・刺身など、一品料理のラインナップ",
  },
  drink: {
    ja: "ドリンク",
    en: "DRINK",
    lead: "ビール・ハイボール・サワー・ソフトドリンク",
  },
  teishoku: {
    ja: "定　食",
    en: "TEISHOKU",
    lead: "丼定食・ランチセット",
  },
};

function renderTableRow(categoryName: string, item: MenuItemRow): string {
  return (
    `<tr>` +
    `<td class="col-cat">${escapeHtml(categoryName)}</td>` +
    `<td class="col-name">${escapeHtml(item.name)}</td>` +
    `<td class="col-net">${escapeHtml(formatYen(item.priceNet))}</td>` +
    `<td class="col-incl">${escapeHtml(formatYen(item.priceIncl))}</td>` +
    `</tr>`
  );
}

function renderChapterTable(subs: MenuSubCategory[]): string {
  const rows = subs
    .flatMap((sub) => sub.items.map((it) => renderTableRow(sub.name, it)))
    .join("");
  if (!rows) return "";
  return (
    `<div class="menu-table-wrap">` +
    `<table class="menu-price-table">` +
    `<thead><tr>` +
    `<th class="col-cat">カテゴリ</th>` +
    `<th class="col-name">商品名</th>` +
    `<th class="col-net">税抜</th>` +
    `<th class="col-incl">税込</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>`
  );
}

function renderChapter(
  kind: MenuChapterKind,
  subs: MenuSubCategory[],
  opts: { storeTitle: string; isFirst: boolean; taxNote: string },
): string {
  if (!subs.length) return "";
  const meta = CHAPTER_META[kind];
  const cover =
    opts.isFirst
      ? `<header class="menu-cover">` +
        `<p class="cover-eyebrow">MENU</p>` +
        `<h1 class="cover-title">${escapeHtml(opts.storeTitle)}</h1>` +
        `<p class="cover-note">${escapeHtml(opts.taxNote)}</p>` +
        `<div class="cover-rule"></div>` +
        `</header>`
      : "";

  return (
    `<section class="a4-chapter chapter-${kind}${opts.isFirst ? " chapter-first" : ""}">` +
    cover +
    `<header class="chapter-head">` +
    `<p class="chapter-en">${escapeHtml(meta.en)}</p>` +
    `<h2 class="chapter-ja">${escapeHtml(meta.ja)}</h2>` +
    `<p class="chapter-lead">${escapeHtml(meta.lead)}</p>` +
    `</header>` +
    renderChapterTable(subs) +
    `<footer class="chapter-foot">` +
    `<span>${escapeHtml(opts.storeTitle)}</span>` +
    `<span>${escapeHtml(meta.ja)}</span>` +
    `</footer>` +
    `</section>`
  );
}

export async function buildMenuPrintHtml(storeId: string): Promise<string | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return null;

  const st = mergeStoreSettings(store.settings);
  const storeTitle = customerFacingStoreName(store.name, st);
  const defaultTaxMode = st.menuPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
  const taxNote = `税抜・税込（消費税 ${st.taxRatePercent}%）`;

  const categories = await prisma.menuCategory.findMany({
    where: { storeId: store.id, visibleToGuest: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        select: {
          name: true,
          price: true,
          priceTaxMode: true,
        },
      },
    },
  });

  const buckets: Record<MenuChapterKind, MenuSubCategory[]> = {
    food: [],
    drink: [],
    teishoku: [],
  };

  for (const cat of categories) {
    const items: MenuItemRow[] = [];
    for (const it of cat.items) {
      const { net, incl } = menuItemNetAndIncl(it.price, it.priceTaxMode, defaultTaxMode, st.taxRatePercent);
      if (incl <= 0) continue;
      items.push({
        name: it.name,
        priceNet: net,
        priceIncl: incl,
      });
    }
    if (!items.length) continue;
    const chapter = classifyMenuPrintChapter(cat.name);
    buckets[chapter].push({ name: cat.name, items });
  }

  const chapterOrder: MenuChapterKind[] = ["food", "drink", "teishoku"];
  const chapters: string[] = [];
  let isFirst = true;
  for (const kind of chapterOrder) {
    if (!buckets[kind].length) continue;
    chapters.push(
      renderChapter(kind, buckets[kind], {
        storeTitle,
        isFirst,
        taxNote,
      }),
    );
    isFirst = false;
  }

  const generatedAt = new Date().toLocaleString("ja-JP", { timeZone: st.timezone, hour12: false });

  let tpl = readFileSync(templatePath("menu-print.html"), "utf8");
  tpl = tpl.replace(/__STORE_NAME__/g, escapeHtml(storeTitle));
  tpl = tpl.replace("__MENU_CHAPTERS__", chapters.join("\n"));
  tpl = tpl.replace("__GENERATED_AT__", escapeHtml(generatedAt));
  tpl = tpl.replace("__TAX_NOTE__", escapeHtml(taxNote));
  return tpl;
}
