import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { recomputeOpenBillTotalForSession } from "./recompute-session-bill.js";
import { mergeStoreSettings } from "./store-settings.js";

export type CourseOptionPackChargeScope = "table_once" | "per_person_pick" | "per_person_all";

export type CourseOptionPackDisplay = {
  id: string;
  name: string;
  chargeScope: CourseOptionPackChargeScope;
  extraPrice: number;
  extraPriceTaxMode: "inclusive" | "exclusive";
  chargeTaxIncluded: number;
  unitChargeTaxIncluded: number;
  totalIfAllGuestsTaxIncluded?: number;
  maxSelectablePeople?: number;
  purchased: boolean;
};

export function parsePurchasedCourseOptionPackIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

export function packChargeScopeFromDb(raw: string | null | undefined): CourseOptionPackChargeScope {
  if (raw === "per_person_pick" || raw === "per_person_all") return raw;
  return "table_once";
}

/** コース＋オプションの表示・注文行は税込円に統一（税抜入力時は店舗税率で換算） */
export function courseOptionPackChargeTaxIncluded(
  extraPrice: number,
  extraPriceTaxMode: string,
  taxRatePercent: number,
): number {
  if (extraPriceTaxMode === "exclusive") {
    return Math.round(extraPrice * (1 + taxRatePercent / 100));
  }
  return extraPrice;
}

export function buildCourseOptionPacksDisplay(
  packRows: {
    id: string;
    name: string;
    chargeScope: string;
    extraPrice: number;
    extraPriceTaxMode: string;
  }[],
  guestCount: number,
  purchasedIds: string[],
  taxRatePercent: number,
): CourseOptionPackDisplay[] {
  const purchasedSet = new Set(purchasedIds);
  const gcMenu = Math.max(1, guestCount);
  return packRows.map((p) => {
    const tm = p.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
    const unitTi = courseOptionPackChargeTaxIncluded(p.extraPrice, tm, taxRatePercent);
    const scope = packChargeScopeFromDb(p.chargeScope);
    if (scope === "table_once") {
      return {
        id: p.id,
        name: p.name,
        chargeScope: scope,
        extraPrice: p.extraPrice,
        extraPriceTaxMode: tm,
        chargeTaxIncluded: unitTi,
        unitChargeTaxIncluded: unitTi,
        purchased: purchasedSet.has(p.id),
      };
    }
    if (scope === "per_person_all") {
      const totalAll = unitTi * gcMenu;
      return {
        id: p.id,
        name: p.name,
        chargeScope: scope,
        extraPrice: p.extraPrice,
        extraPriceTaxMode: tm,
        chargeTaxIncluded: totalAll,
        unitChargeTaxIncluded: unitTi,
        totalIfAllGuestsTaxIncluded: totalAll,
        purchased: purchasedSet.has(p.id),
      };
    }
    return {
      id: p.id,
      name: p.name,
      chargeScope: scope,
      extraPrice: p.extraPrice,
      extraPriceTaxMode: tm,
      chargeTaxIncluded: unitTi,
      unitChargeTaxIncluded: unitTi,
      maxSelectablePeople: gcMenu,
      purchased: purchasedSet.has(p.id),
    };
  });
}

export type PurchaseCourseOptionPackResult =
  | { ok: true; orderId: string }
  | { ok: false; code: "SESSION_GONE" | "ALREADY" | "PACK_GONE" | "NO_COURSE" | "BAD_PEOPLE" | "NOT_FOUND" };

export async function purchaseCourseOptionPackInTx(
  tx: Prisma.TransactionClient,
  input: {
    billingSessionId: string;
    packId: string;
    peopleCount?: number | null;
    orderSourceTableId?: string | null;
  },
): Promise<PurchaseCourseOptionPackResult> {
  const sess = await tx.diningSession.findUnique({ where: { id: input.billingSessionId } });
  if (!sess || sess.status !== "open") return { ok: false, code: "SESSION_GONE" };
  const cur = parsePurchasedCourseOptionPackIds(sess.purchasedCourseOptionPackIds);
  if (cur.includes(input.packId)) return { ok: false, code: "ALREADY" };
  if (!sess.courseId) return { ok: false, code: "NO_COURSE" };
  const packRow = await tx.courseOptionPack.findFirst({
    where: { id: input.packId, courseId: sess.courseId },
  });
  if (!packRow) return { ok: false, code: "PACK_GONE" };
  const storeRowTx = await tx.store.findUnique({
    where: { id: sess.storeId },
    select: { settings: true },
  });
  const stTx = mergeStoreSettings(storeRowTx?.settings);
  const tm = packRow.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
  const unitPriceTaxInc = courseOptionPackChargeTaxIncluded(packRow.extraPrice, tm, stTx.taxRatePercent);
  const scope = packChargeScopeFromDb(packRow.chargeScope);
  const gc = Math.max(1, sess.guestCount);
  let qty = 1;
  let unitPrice = unitPriceTaxInc;
  if (scope === "table_once") {
    qty = 1;
    unitPrice = unitPriceTaxInc;
  } else if (scope === "per_person_pick") {
    qty = input.peopleCount ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > gc) return { ok: false, code: "BAD_PEOPLE" };
    unitPrice = unitPriceTaxInc;
  } else {
    qty = gc;
    unitPrice = unitPriceTaxInc;
  }
  const nameSnap =
    scope === "table_once"
      ? `[コース＋オプション] ${packRow.name}`
      : `[コース＋オプション] ${packRow.name}（×${qty}名）`;
  const so = await tx.salesOrder.create({
    data: {
      sessionId: input.billingSessionId,
      ...(input.orderSourceTableId ? { sourceTableId: input.orderSourceTableId } : {}),
      status: "submitted",
      note: null,
    },
  });
  const lineExtra = {
    kind: "courseOptionPack",
    courseOptionPackId: packRow.id,
    chargeScope: scope,
    peopleCount: qty,
  };
  await tx.orderLine.create({
    data: {
      orderId: so.id,
      menuItemId: null,
      nameSnapshot: nameSnap,
      unitPrice,
      qty,
      note: null,
      lineExtra: lineExtra as Prisma.InputJsonValue,
      status: "queued",
    },
  });
  await tx.diningSession.update({
    where: { id: sess.id },
    data: {
      purchasedCourseOptionPackIds: [...cur, packRow.id],
    },
  });
  await recomputeOpenBillTotalForSession(tx, sess.storeId, sess.id);
  return { ok: true, orderId: so.id };
}

export function purchaseCourseOptionPackErrorToHttp(
  code: Exclude<PurchaseCourseOptionPackResult, { ok: true }>["code"],
): { status: number; error: string } {
  switch (code) {
    case "SESSION_GONE":
      return { status: 404, error: "session not found or closed" };
    case "ALREADY":
      return { status: 409, error: "すでに追加済みです" };
    case "PACK_GONE":
    case "NO_COURSE":
    case "NOT_FOUND":
      return { status: 404, error: "オプションが見つかりません" };
    case "BAD_PEOPLE":
      return { status: 400, error: "人数が無効です" };
    default:
      return { status: 400, error: "invalid request" };
  }
}
