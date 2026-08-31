import { prisma } from "../db.js";
import { baseNetFromStoredPrice, resolveItemPriceTaxMode, taxIncludedFromNet } from "./order-line-tax.js";
import { customerFacingStoreName, mergeStoreSettings } from "./store-settings.js";
import { classifyMenuPrintChapter } from "./menu-print-html.js";

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceNet: number;
  priceIncl: number;
  soldOut: boolean;
  lowStock: boolean;
  containsAlcohol: boolean;
  chapter: "food" | "drink" | "teishoku";
};

export type PublicMenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
  chapter: "food" | "drink" | "teishoku";
  items: PublicMenuItem[];
};

export type PublicMenuPayload = {
  store: { id: string; name: string };
  taxRatePercent: number;
  timezone: string;
  priceDisplay: "exclusive";
  categories: PublicMenuCategory[];
};

function menuItemNetAndIncl(
  storedPrice: number,
  priceTaxMode: string,
  defaultMode: "inclusive" | "exclusive",
  taxRatePercent: number,
): { net: number; incl: number } {
  const mode = resolveItemPriceTaxMode(priceTaxMode, defaultMode);
  const net = baseNetFromStoredPrice(storedPrice, mode, taxRatePercent);
  const incl = taxIncludedFromNet(net, taxRatePercent);
  return { net, incl };
}

/** 店舗HP向け：ゲスト表示可能な全メニュー（テイクアウト制限なし・店内税率） */
export async function buildPublicMenuJson(storeId: string): Promise<PublicMenuPayload | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, settings: true },
  });
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
          id: true,
          name: true,
          description: true,
          price: true,
          priceTaxMode: true,
          imageUrl: true,
          stockQty: true,
          stockLowThreshold: true,
          containsAlcohol: true,
        },
      },
    },
  });

  const outCategories: PublicMenuCategory[] = [];

  for (const cat of categories) {
    const chapter = classifyMenuPrintChapter(cat.name);
    const items: PublicMenuItem[] = [];
    for (const it of cat.items) {
      const { net, incl } = menuItemNetAndIncl(it.price, it.priceTaxMode, defaultTaxMode, st.taxRatePercent);
      if (incl <= 0) continue;
      const soldOut = it.stockQty != null && it.stockQty <= 0;
      const lowStock =
        it.stockQty != null &&
        it.stockLowThreshold != null &&
        it.stockQty <= it.stockLowThreshold;
      items.push({
        id: it.id,
        name: it.name,
        description: it.description,
        imageUrl: it.imageUrl,
        priceNet: Math.round(net),
        priceIncl: Math.round(incl),
        soldOut,
        lowStock,
        containsAlcohol: it.containsAlcohol === true,
        chapter,
      });
    }
    if (!items.length) continue;
    outCategories.push({
      id: cat.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
      chapter,
      items,
    });
  }

  return {
    store: { id: store.id, name: storeTitle },
    taxRatePercent: st.taxRatePercent,
    timezone: st.timezone,
    priceDisplay: "exclusive",
    categories: outCategories,
  };
}
