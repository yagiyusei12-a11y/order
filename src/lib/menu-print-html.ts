import { readFileSync } from "node:fs";
import { prisma } from "../db.js";
import { taxIncludedFromNet } from "./order-line-tax.js";
import { templatePath } from "./paths.js";
import { customerFacingStoreName, mergeStoreSettings } from "./store-settings.js";

type MenuChapterKind = "food" | "drink" | "teishoku";

type MenuItemRow = {
  name: string;
  price: number;
  imageUrl: string | null;
  description: string | null;
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

function taxIncludedMenuPrice(
  price: number,
  priceTaxMode: string,
  defaultMode: "inclusive" | "exclusive",
  taxRatePercent: number,
): number {
  const mode = priceTaxMode === "exclusive" ? "exclusive" : defaultMode;
  if (mode === "exclusive") return taxIncludedFromNet(price, taxRatePercent);
  return price;
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

function renderPhoto(imageUrl: string | null, size: "sm" | "md" | "lg"): string {
  const cls = `photo photo-${size}`;
  if (imageUrl) {
    return `<div class="${cls}"><img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" /></div>`;
  }
  return `<div class="${cls} photo-empty" aria-hidden="true"></div>`;
}

function renderListRow(item: MenuItemRow, showPhoto: boolean): string {
  const photo = showPhoto ? renderPhoto(item.imageUrl, "sm") : "";
  const desc =
    item.description && item.description.trim()
      ? `<p class="row-desc">${escapeHtml(item.description.trim())}</p>`
      : "";
  return (
    `<div class="menu-row${showPhoto ? " has-photo" : ""}">` +
    photo +
    `<div class="row-body">` +
    `<div class="row-line">` +
    `<span class="row-name">${escapeHtml(item.name)}</span>` +
    `<span class="row-dots" aria-hidden="true"></span>` +
    `<span class="row-price">${escapeHtml(formatYen(item.price))}</span>` +
    `</div>` +
    desc +
    `</div>` +
    `</div>`
  );
}

function renderTeishokuCard(item: MenuItemRow): string {
  const desc =
    item.description && item.description.trim()
      ? `<p class="card-desc">${escapeHtml(item.description.trim())}</p>`
      : "";
  return (
    `<article class="teishoku-card">` +
    renderPhoto(item.imageUrl, "lg") +
    `<div class="card-body">` +
    `<h4 class="card-name">${escapeHtml(item.name)}</h4>` +
    desc +
    `<p class="card-price">${escapeHtml(formatYen(item.price))}</p>` +
    `</div>` +
    `</article>`
  );
}

function renderSubCategory(sub: MenuSubCategory, kind: MenuChapterKind): string {
  if (!sub.items.length) return "";
  if (kind === "teishoku") {
    return (
      `<section class="subcat subcat-teishoku">` +
      `<h3 class="subcat-title">${escapeHtml(sub.name)}</h3>` +
      `<div class="teishoku-grid">${sub.items.map(renderTeishokuCard).join("")}</div>` +
      `</section>`
    );
  }
  const showPhoto = kind === "food";
  return (
    `<section class="subcat subcat-list">` +
    `<h3 class="subcat-title">${escapeHtml(sub.name)}</h3>` +
    `<div class="list-cols">${sub.items.map((it) => renderListRow(it, showPhoto)).join("")}</div>` +
    `</section>`
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
    subs.map((s) => renderSubCategory(s, kind)).join("") +
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
  const taxNote = `表示価格は税込（${st.taxRatePercent}%）`;

  const categories = await prisma.menuCategory.findMany({
    where: { storeId: store.id, visibleToGuest: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        select: {
          name: true,
          description: true,
          price: true,
          priceTaxMode: true,
          imageUrl: true,
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
      const incl = taxIncludedMenuPrice(it.price, it.priceTaxMode, defaultTaxMode, st.taxRatePercent);
      if (incl <= 0) continue;
      items.push({
        name: it.name,
        price: incl,
        imageUrl: it.imageUrl,
        description: it.description,
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
