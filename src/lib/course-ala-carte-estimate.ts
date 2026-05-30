import { computeCourseSessionTotal } from "./course-pricing.js";
import {
  computeLineDiscountAmountYen,
  computeSessionSuggestedTotal,
  parseBillDiscounts,
  parseLineDiscount,
  type OpsBillDiscountJson,
} from "./ops-discount.js";
import {
  baseNetFromStoredPrice,
  eatModeTaxRatePercent,
  normalizeEatMode,
  taxIncludedFromNet,
} from "./order-line-tax.js";
import { SET_SERVE_LATER_LINE_KIND } from "./set-order-bundle.js";

export type MenuItemForAlaCarte = {
  id: string;
  price: number;
  priceTaxMode: string;
  sellKind: string;
};

export type OrderLineForAlaCarte = {
  id: string;
  nameSnapshot: string;
  qty: number;
  unitPrice: number;
  status: string;
  menuItemId: string | null;
  lineExtra: unknown;
  eatMode: string;
  taxRatePercent: number;
  discountJson: unknown;
};

export type AlaCarteLineDetail = {
  lineId: string;
  nameSnapshot: string;
  qty: number;
  actualLineTotal: number;
  alaCarteLineTotal: number;
  repriced: boolean;
};

export type AlaCarteBillEstimate = {
  orderLinesActual: number;
  alaCarteOrdersNet: number;
  alaCarteTotal: number;
  diff: number;
  lineDetails: AlaCarteLineDetail[];
};

type StoreTaxSettings = {
  taxRatePercent: number;
  menuPriceTaxMode: "inclusive" | "exclusive";
};

function lineExtraKind(lineExtra: unknown): string {
  if (!lineExtra || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return "";
  const k = (lineExtra as { kind?: unknown }).kind;
  return typeof k === "string" ? k : "";
}

function sumOptionsFromSingleLineExtra(lineExtra: unknown): number {
  if (lineExtraKind(lineExtra) !== "single") return 0;
  const opts = (lineExtra as { options?: unknown }).options;
  if (!Array.isArray(opts)) return 0;
  let sum = 0;
  for (const row of opts) {
    if (!row || typeof row !== "object") continue;
    const picks = (row as { picks?: { priceDelta?: number }[] }).picks;
    if (!Array.isArray(picks)) continue;
    for (const p of picks) {
      sum += Number(p?.priceDelta) || 0;
    }
  }
  return sum;
}

function sumSetSurchargesFromLineExtra(lineExtra: unknown): number {
  if (lineExtraKind(lineExtra) !== "set") return 0;
  const steps = (lineExtra as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return 0;
  let sum = 0;
  for (const st of steps) {
    if (!st || typeof st !== "object") continue;
    const picks = (st as { picks?: { surchargeInclusiveYen?: number }[] }).picks;
    if (!Array.isArray(picks)) continue;
    for (const p of picks) {
      sum += Number(p?.surchargeInclusiveYen) || 0;
    }
  }
  return sum;
}

function menuItemUnitTaxIncluded(
  item: MenuItemForAlaCarte,
  eatMode: string,
  store: StoreTaxSettings,
): number {
  const storedMode =
    item.priceTaxMode === "exclusive" ? "exclusive" : store.menuPriceTaxMode;
  const taxRate = eatModeTaxRatePercent(normalizeEatMode(eatMode), store.taxRatePercent);
  const net = baseNetFromStoredPrice(item.price, storedMode, store.taxRatePercent);
  return taxIncludedFromNet(net, taxRate);
}

/** 単品行の税込小計（割引前）。コース内0円行はメニュー定価ベースで試算。 */
export function estimateLineAlaCarteGross(
  line: OrderLineForAlaCarte,
  menuById: Map<string, MenuItemForAlaCarte>,
  store: StoreTaxSettings,
): { gross: number; repriced: boolean } {
  if (line.status === "cancelled") return { gross: 0, repriced: false };

  const kind = lineExtraKind(line.lineExtra);
  if (kind === "courseOptionPack") return { gross: 0, repriced: true };

  const qty = Math.max(0, line.qty);
  const actualGross = line.unitPrice * qty;
  if (line.unitPrice > 0) return { gross: actualGross, repriced: false };

  if (kind === "customLine") return { gross: actualGross, repriced: false };

  const menuItemId = line.menuItemId;
  if (!menuItemId) return { gross: actualGross, repriced: false };

  const item = menuById.get(menuItemId);
  if (!item) return { gross: actualGross, repriced: false };

  const eatMode = line.eatMode || "dine_in";
  const base = menuItemUnitTaxIncluded(item, eatMode, store);

  if (kind === "set" || item.sellKind === "set") {
    const surcharge = sumSetSurchargesFromLineExtra(line.lineExtra);
    return { gross: qty * (base + surcharge), repriced: true };
  }

  if (kind === SET_SERVE_LATER_LINE_KIND) {
    return { gross: qty * base, repriced: true };
  }

  const optSum = sumOptionsFromSingleLineExtra(line.lineExtra);
  return { gross: qty * (base + optSum), repriced: true };
}

function lineNetAfterDiscount(
  gross: number,
  unitPrice: number,
  qty: number,
  discountJson: unknown,
): number {
  const disc = parseLineDiscount(discountJson);
  const discAmt = computeLineDiscountAmountYen(gross, unitPrice, qty, disc);
  return Math.max(0, gross - discAmt);
}

export function estimateBillAlaCarte(params: {
  lines: OrderLineForAlaCarte[];
  billDiscounts: OpsBillDiscountJson[];
  menuById: Map<string, MenuItemForAlaCarte>;
  store: StoreTaxSettings;
}): AlaCarteBillEstimate {
  const lineDetails: AlaCarteLineDetail[] = [];
  let orderLinesActual = 0;
  let alaCarteOrdersGross = 0;

  const hypoLines: OrderLineForAlaCarte[] = [];

  for (const line of params.lines) {
    if (line.status === "cancelled") continue;
    const actualGross = line.unitPrice * line.qty;
    const { gross: alaGross, repriced } = estimateLineAlaCarteGross(line, params.menuById, params.store);
    const alaUnit = line.qty > 0 ? Math.round(alaGross / line.qty) : 0;

    orderLinesActual += lineNetAfterDiscount(
      actualGross,
      line.unitPrice,
      line.qty,
      line.discountJson,
    );
    alaCarteOrdersGross += alaGross;

    lineDetails.push({
      lineId: line.id,
      nameSnapshot: line.nameSnapshot,
      qty: line.qty,
      actualLineTotal: lineNetAfterDiscount(
        actualGross,
        line.unitPrice,
        line.qty,
        line.discountJson,
      ),
      alaCarteLineTotal: lineNetAfterDiscount(alaGross, alaUnit, line.qty, line.discountJson),
      repriced,
    });

    hypoLines.push({ ...line, unitPrice: alaUnit });
  }

  const actualPreview = computeSessionSuggestedTotal(0, [{ lines: params.lines }], params.billDiscounts);
  orderLinesActual = actualPreview.ordersNet;

  const hypoPreview = computeSessionSuggestedTotal(
    0,
    [{ lines: hypoLines }],
    params.billDiscounts,
  );

  return {
    orderLinesActual,
    alaCarteOrdersNet: hypoPreview.ordersNet,
    alaCarteTotal: hypoPreview.suggestedTotal,
    diff: 0,
    lineDetails,
  };
}

export function parseBillDiscountsFromJson(raw: unknown): OpsBillDiscountJson[] {
  return parseBillDiscounts(raw);
}

export { computeCourseSessionTotal };
