import { readFileSync } from "node:fs";
import { prisma } from "../db.js";
import { taxIncludedFromNet } from "./order-line-tax.js";
import { templatePath } from "./paths.js";
import { customerFacingStoreName, mergeStoreSettings } from "./store-settings.js";

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

function renderItemCard(name: string, price: number, imageUrl: string | null, description: string | null): string {
  const imgBlock = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />`
    : `<div class="no-img" aria-hidden="true">🍽</div>`;
  const desc =
    description && description.trim()
      ? `<p class="desc">${escapeHtml(description.trim())}</p>`
      : "";
  return (
    `<article class="item">` +
    `<div class="img-wrap">${imgBlock}</div>` +
    `<div class="meta">` +
    `<h3 class="name">${escapeHtml(name)}</h3>` +
    desc +
    `<p class="price">${escapeHtml(formatYen(price))}</p>` +
    `</div>` +
    `</article>`
  );
}

export async function buildMenuPrintHtml(storeId: string): Promise<string | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return null;

  const st = mergeStoreSettings(store.settings);
  const storeTitle = customerFacingStoreName(store.name, st);
  const defaultTaxMode = st.menuPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";

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

  const sections: string[] = [];
  for (const cat of categories) {
    const cards: string[] = [];
    for (const it of cat.items) {
      const incl = taxIncludedMenuPrice(it.price, it.priceTaxMode, defaultTaxMode, st.taxRatePercent);
      if (incl <= 0) continue;
      cards.push(renderItemCard(it.name, incl, it.imageUrl, it.description));
    }
    if (!cards.length) continue;
    sections.push(
      `<section class="cat">` +
        `<h2 class="cat-title">${escapeHtml(cat.name)}</h2>` +
        `<div class="grid">${cards.join("")}</div>` +
        `</section>`,
    );
  }

  const generatedAt = new Date().toLocaleString("ja-JP", { timeZone: st.timezone, hour12: false });

  let tpl = readFileSync(templatePath("menu-print.html"), "utf8");
  tpl = tpl.replace(/__STORE_NAME__/g, escapeHtml(storeTitle));
  tpl = tpl.replace("__MENU_SECTIONS__", sections.join("\n"));
  tpl = tpl.replace("__GENERATED_AT__", escapeHtml(generatedAt));
  tpl = tpl.replace("__TAX_NOTE__", escapeHtml(`表示価格は税込（${st.taxRatePercent}%）です。`));
  return tpl;
}
