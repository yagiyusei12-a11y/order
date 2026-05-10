import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import {
  applyGuestItemTimeDiscounts,
  categoryGuestVisibleAt,
} from "../lib/guest-time-pricing.js";
import {
  buildSingleNameSnapshotWithOptions,
  buildSingleOptionsLineExtra,
  sumInclusiveOptionPriceDelta,
  validateGuestOptionSelections,
  type GuestOptionGroupSelection,
} from "../lib/guest-order-options.js";
import {
  buildSetLineExtra,
  buildSetLineExtraOmitStepIds,
  buildSetNameSnapshot,
  surchargeExclusiveStepSumInclusive,
  validateSetSelections,
  type GuestSetStepSelection,
  type SetStepForValidation,
} from "../lib/menu-set-order.js";
import {
  isSetServeLaterLine,
  ORDER_LINE_STATUS_GUEST_DEFERRED,
  SET_SERVE_LATER_LINE_KIND,
} from "../lib/set-order-bundle.js";
import {
  baseNetFromStoredPrice,
  eatModeTaxRatePercent,
  normalizeEatMode,
  retaxInclusiveYen,
  taxIncludedFromNet,
  type EatMode,
} from "../lib/order-line-tax.js";
import { evaluatePublicOrderGate } from "../lib/store-order-gate.js";
import {
  mergeStoreSettings,
  type GuestLastOrderAfterDeadlinePolicy,
} from "../lib/store-settings.js";
import { displayTableCode } from "../lib/table-display-code.js";
import { mergeTwoOpenSessionsTx } from "../lib/session-merge.js";
import { prisma } from "../db.js";

type GuestBillingContext = {
  billingSessionId: string;
  /** 合算子卓の QR からの注文のみ設定（代表卓直の注文は null） */
  orderSourceTableId: string | null;
};

/**
 * ゲスト注文・メニューの請求先セッション。
 * - open: 自分自身
 * - merged: 親（open）セッション。注文は sourceTableId に子卓を付ける
 */
async function resolveGuestBillingContext(session: {
  id: string;
  status: string;
  storeId: string;
  tableId: string;
  mergedIntoSessionId: string | null;
}): Promise<
  | { ok: true; ctx: GuestBillingContext }
  | { ok: false; status: 404 | 409; body: { error: string; message?: string } }
> {
  if (session.status === "open") {
    return { ok: true, ctx: { billingSessionId: session.id, orderSourceTableId: null } };
  }
  if (session.status === "merged" && session.mergedIntoSessionId) {
    const parent = await prisma.diningSession.findFirst({
      where: { id: session.mergedIntoSessionId, storeId: session.storeId, status: "open" },
      select: { id: true },
    });
    if (!parent) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "merge_parent_unavailable",
          message: "代表卓のセッションが利用中ではありません。スタッフにお声がけください。",
        },
      };
    }
    return {
      ok: true,
      ctx: { billingSessionId: parent.id, orderSourceTableId: session.tableId },
    };
  }
  return { ok: false, status: 404, body: { error: "session not found or closed" } };
}

/** POST lines の後から提供ステップ id。配列があれば単体フィールドより優先 */
function parseGuestServeLaterDeferStepIds(line: Record<string, unknown>): string[] {
  const rawArr = line.serveLaterDeferStepIds;
  const out: string[] = [];
  if (Array.isArray(rawArr)) {
    for (const x of rawArr) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  const uniq = [...new Set(out)];
  if (uniq.length > 0) return uniq;
  const single = line.serveLaterDeferStepId;
  if (typeof single === "string" && single.trim()) return [single.trim()];
  return [];
}

function normalizeServeLaterGroupStored(v: string | null | undefined): "none" | "drink" | "dessert" {
  if (v === "drink" || v === "dessert") return v;
  return "none";
}

function mapGuestMenuItem(
  it: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    priceTaxMode: string;
    sellKind?: string;
    containsAlcohol?: boolean;
    allowTakeout?: boolean;
    stockQty: number | null;
    stockLowThreshold: number | null;
    timeDiscounts?: {
      discountKind: string;
      value: number;
      timeWindow: { startMin: number; endMin: number };
    }[];
  },
  defaultPriceTaxMode: "inclusive" | "exclusive",
  taxRatePercent: number,
  nowMin: number,
) {
  const priceTaxMode = it.priceTaxMode === "exclusive" ? "exclusive" : defaultPriceTaxMode;
  const taxIncludedPrice =
    priceTaxMode === "exclusive"
      ? Math.round(it.price * (1 + taxRatePercent / 100))
      : it.price;
  const discRows = (it.timeDiscounts || []).map((d) => ({
    discountKind: d.discountKind,
    value: d.value,
    timeWindow: d.timeWindow,
  }));
  const { price: discounted, applied } = applyGuestItemTimeDiscounts(taxIncludedPrice, discRows, nowMin);
  const lowStock =
    it.stockQty != null &&
    it.stockLowThreshold != null &&
    it.stockQty <= it.stockLowThreshold;
  const out: Record<string, unknown> = {
    id: it.id,
    name: it.name,
    description: it.description,
    imageUrl: it.imageUrl,
    sellKind: it.sellKind === "set" ? "set" : "single",
    price: discounted,
    priceTaxMode,
    basePrice: it.price,
    taxIncludedPrice: discounted,
    allowTakeout: it.allowTakeout === true,
    stockQty: it.stockQty,
    lowStock,
    containsAlcohol: it.containsAlcohol === true,
  };
  if (applied && discounted !== taxIncludedPrice) {
    out.originalTaxIncludedPrice = taxIncludedPrice;
    out.timeDiscount = {
      kind: applied.discountKind,
      value: applied.value,
    };
  }
  return out;
}

function mapGuestOptionGroups(
  links: {
    sortOrder: number;
    optionGroup: {
      id: string;
      name: string;
      active: boolean;
      minSelect: number;
      maxSelect: number;
      items: { id: string; name: string; priceDelta: number; active: boolean }[];
    } | null;
  }[],
): Record<string, unknown>[] {
  const sorted = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: Record<string, unknown>[] = [];
  for (const l of sorted) {
    const g = l.optionGroup;
    if (!g || !g.active) continue;
    const activeItems = g.items.filter((it) => it.active);
    if (!activeItems.length) continue;
    out.push({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      items: activeItems.map((it) => ({
        id: it.id,
        name: it.name,
        priceDelta: it.priceDelta,
      })),
    });
  }
  return out;
}

function componentVisibleToGuest(
  cat: {
    guestVisibleTimeWindowId: string | null;
    guestVisibleStartMin: number | null;
    guestVisibleEndMin: number | null;
    guestVisibleTimeWindow: { startMin: number; endMin: number } | null;
  },
  nowMin: number,
): boolean {
  const w = cat.guestVisibleTimeWindow;
  const slice = w ? { startMin: w.startMin, endMin: w.endMin } : null;
  return categoryGuestVisibleAt(cat, slice, nowMin);
}

/** コース終了の offset 分前を締め時としたときのゲスト向けラストオーダー情報 */
function computeGuestLastOrderPayload(
  openedAt: Date,
  durationMinutes: number,
  offsetMinutesBeforeEnd: number,
  policy: GuestLastOrderAfterDeadlinePolicy,
): {
  deadlineIso: string;
  secondsRemaining: number;
  pastDeadline: boolean;
  /** block_all かつ締切後（従来の orderingClosed と同等） */
  orderingClosed: boolean;
  policy: GuestLastOrderAfterDeadlinePolicy;
  /** 従来: guestEnforceLastOrder。block_all のときだけ締切後にクライアントが全面ブロックする */
  blocksOrderingAfterDeadline: boolean;
  /** 締切後に単品（通常行）を拒否する */
  blocksSinglesAfterDeadline: boolean;
  /** 締切後にセット行を拒否する */
  blocksSetsAfterDeadline: boolean;
  /** 締切後にコースオプションパック購入を拒否する */
  blocksOptionPackAfterDeadline: boolean;
} | null {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const offset = Math.min(Math.max(0, offsetMinutesBeforeEnd), durationMinutes);
  const deadlineMs = openedAt.getTime() + (durationMinutes - offset) * 60 * 1000;
  const now = Date.now();
  const pastDeadline = now > deadlineMs;
  const orderingClosed = pastDeadline && policy === "block_all";
  const secondsRemaining = Math.floor((deadlineMs - now) / 1000);
  const blocksOrderingAfterDeadline = policy === "block_all";
  const blocksSinglesAfterDeadline = pastDeadline && policy === "block_all";
  const blocksSetsAfterDeadline = pastDeadline && policy !== "allow_all";
  const blocksOptionPackAfterDeadline = pastDeadline && policy !== "allow_all";
  return {
    deadlineIso: new Date(deadlineMs).toISOString(),
    secondsRemaining,
    pastDeadline,
    orderingClosed,
    policy,
    blocksOrderingAfterDeadline,
    blocksSinglesAfterDeadline,
    blocksSetsAfterDeadline,
    blocksOptionPackAfterDeadline,
  };
}

function mapGuestSetMenuItem(
  it: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    priceTaxMode: string;
    containsAlcohol?: boolean;
    stockQty: number | null;
    stockLowThreshold: number | null;
    sellKind: string;
    timeDiscounts?: {
      discountKind: string;
      value: number;
      timeWindow: { startMin: number; endMin: number };
    }[];
    optionLinks?: {
      sortOrder: number;
      optionGroup: {
        id: string;
        name: string;
        active: boolean;
        minSelect: number;
        maxSelect: number;
        items: { id: string; name: string; priceDelta: number; active: boolean }[];
      } | null;
    }[];
    setSteps: {
      id: string;
      label: string;
      minPick: number;
      maxPick: number;
      sortOrder: number;
      allowServeLaterSplit?: boolean;
      serveLaterGroup?: string;
      choices: {
        componentMenuItemId: string;
        extraPrice: number;
        sortOrder: number;
        isFixed?: boolean;
        componentMenuItem: {
          id: string;
          name: string;
          isAvailable: boolean;
          containsAlcohol?: boolean;
          stockQty: number | null;
          stockLowThreshold: number | null;
          category: {
            visibleToGuest: boolean;
            guestVisibleTimeWindowId: string | null;
            guestVisibleStartMin: number | null;
            guestVisibleEndMin: number | null;
            guestVisibleTimeWindow: { startMin: number; endMin: number } | null;
          };
          optionLinks?: {
            sortOrder: number;
            optionGroup: {
              id: string;
              name: string;
              active: boolean;
              minSelect: number;
              maxSelect: number;
              items: { id: string; name: string; priceDelta: number; active: boolean }[];
            } | null;
          }[];
        };
      }[];
    }[];
  },
  defaultPriceTaxMode: "inclusive" | "exclusive",
  taxRatePercent: number,
  nowMin: number,
): Record<string, unknown> | null {
  const stepsOut: Record<string, unknown>[] = [];
  type ChoiceRow = {
    menuItemId: string;
    name: string;
    extraPrice: number;
    extraTaxIncluded: number;
    stockQty: number | null;
    soldOut: boolean;
    containsAlcohol: boolean;
    optionGroups?: Record<string, unknown>[];
  };
  for (const st of it.setSteps) {
    const choices: ChoiceRow[] = [];
    const fixedChoices: ChoiceRow[] = [];
    for (const ch of st.choices) {
      const comp = ch.componentMenuItem;
      const ex = ch.extraPrice;
      const soldOut = comp.stockQty != null && comp.stockQty <= 0;
      const compName = (typeof comp.name === "string" ? comp.name : "").trim();
      const row: ChoiceRow = {
        menuItemId: comp.id,
        name: compName || "（名称未設定）",
        extraPrice: ex,
        extraTaxIncluded: Math.round(ex * (1 + taxRatePercent / 100)),
        stockQty: comp.stockQty,
        soldOut,
        containsAlcohol: comp.containsAlcohol === true,
      };
      try {
        const opt = mapGuestOptionGroups(comp.optionLinks ?? []);
        if (opt.length) row.optionGroups = opt;
      } catch (_) {}
      if (ch.isFixed === true) {
        // 標準付属は「セットの一部」なので、カテゴリのゲスト表示設定に関わらず表示対象にする。
        //（ゲスト非表示カテゴリを参照しているだけでセット自体が消えるのを防ぐ）
        if (!comp.isAvailable) return null;
        if (soldOut) return null;
        fixedChoices.push(row);
        continue;
      }
      if (!comp.isAvailable) continue;
      // セットの選択肢もカテゴリのゲスト表示設定に関わらず表示対象にする
      choices.push(row);
    }
    const selectable = choices.filter((c) => !c.soldOut).length;
    if (st.minPick > 0 && selectable < st.minPick) {
      return null;
    }
    const sg =
      st.serveLaterGroup === "drink" || st.serveLaterGroup === "dessert" ? st.serveLaterGroup : "none";
    stepsOut.push({
      id: st.id,
      label: st.label,
      minPick: st.minPick,
      maxPick: st.maxPick,
      sortOrder: st.sortOrder,
      allowServeLaterSplit: st.allowServeLaterSplit === true,
      serveLaterGroup: sg,
      choices,
      fixedChoices,
    });
  }
  if (stepsOut.length === 0) return null;
  const base = mapGuestMenuItem(it, defaultPriceTaxMode, taxRatePercent, nowMin);
  const opt = mapGuestOptionGroups(it.optionLinks ?? []);
  return opt.length ? { ...base, sellKind: "set", setSteps: stepsOut, optionGroups: opt } : { ...base, sellKind: "set", setSteps: stepsOut };
}

/** 注文履歴からの再注文用。売切・非表示でも構成 ID を復元できるよう緩いルール（通常メニュー API とは別） */
function mapGuestSetMenuItemForReorder(
  it: Parameters<typeof mapGuestSetMenuItem>[0],
  defaultPriceTaxMode: "inclusive" | "exclusive",
  taxRatePercent: number,
  nowMin: number,
): Record<string, unknown> | null {
  const stepsOut: Record<string, unknown>[] = [];
  type ChoiceRow = {
    menuItemId: string;
    name: string;
    extraPrice: number;
    extraTaxIncluded: number;
    stockQty: number | null;
    soldOut: boolean;
    containsAlcohol: boolean;
    optionGroups?: Record<string, unknown>[];
  };
  for (const st of it.setSteps) {
    const choices: ChoiceRow[] = [];
    const fixedChoices: ChoiceRow[] = [];
    for (const ch of st.choices) {
      const comp = ch.componentMenuItem;
      if (!comp) continue;
      const ex = ch.extraPrice;
      const soldOut = comp.stockQty != null && comp.stockQty <= 0;
      const compName = (typeof comp.name === "string" ? comp.name : "").trim();
      const row: ChoiceRow = {
        menuItemId: comp.id,
        name: compName || "（名称未設定）",
        extraPrice: ex,
        extraTaxIncluded: Math.round(ex * (1 + taxRatePercent / 100)),
        stockQty: comp.stockQty,
        soldOut,
        containsAlcohol: comp.containsAlcohol === true,
      };
      try {
        const opt = mapGuestOptionGroups(comp.optionLinks ?? []);
        if (opt.length) row.optionGroups = opt;
      } catch (_) {}
      if (ch.isFixed === true) {
        fixedChoices.push(row);
        continue;
      }
      choices.push(row);
    }
    const sgR =
      st.serveLaterGroup === "drink" || st.serveLaterGroup === "dessert" ? st.serveLaterGroup : "none";
    stepsOut.push({
      id: st.id,
      label: st.label,
      minPick: st.minPick,
      maxPick: st.maxPick,
      sortOrder: st.sortOrder,
      allowServeLaterSplit: st.allowServeLaterSplit === true,
      serveLaterGroup: sgR,
      choices,
      fixedChoices,
    });
  }
  if (stepsOut.length === 0) return null;
  const base = mapGuestMenuItem(it, defaultPriceTaxMode, taxRatePercent, nowMin);
  const opt = mapGuestOptionGroups(it.optionLinks ?? []);
  return opt.length ? { ...base, sellKind: "set", setSteps: stepsOut, optionGroups: opt } : { ...base, sellKind: "set", setSteps: stepsOut };
}

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{8,128}$/;

function parsePurchasedCourseOptionPackIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

/** コース＋オプションの表示・注文行は税込円に統一（税抜入力時は店舗税率で換算） */
function courseOptionPackChargeTaxIncluded(
  extraPrice: number,
  extraPriceTaxMode: string,
  taxRatePercent: number,
): number {
  if (extraPriceTaxMode === "exclusive") {
    return Math.round(extraPrice * (1 + taxRatePercent / 100));
  }
  return extraPrice;
}

function packChargeScopeFromDb(
  raw: string | null | undefined,
): "table_once" | "per_person_pick" | "per_person_all" {
  if (raw === "per_person_pick" || raw === "per_person_all") return raw;
  return "table_once";
}

function normalizeOptionalProfile(
  name: unknown,
  phone: unknown,
): { name: string | null; phone: string | null } {
  const n = typeof name === "string" ? name.trim().slice(0, 100) : "";
  const p = typeof phone === "string" ? phone.replace(/\s/g, "").slice(0, 20) : "";
  return { name: n || null, phone: p || null };
}

export async function registerGuest(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/guest/:token/menu", async (req, reply) => {
    const menuInclude = {
      course: {
        include: { includedItems: { select: { menuItemId: true } } },
      },
      coursePriceTier: true,
      customer: { select: { name: true, phone: true } },
      table: { select: { publicCode: true } },
    } as const;
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: menuInclude,
    });
    if (!tokenSession) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const billing = await resolveGuestBillingContext(tokenSession);
    if (!billing.ok) {
      return reply.code(billing.status).send(billing.body);
    }
    let session = tokenSession;
    if (billing.ctx.billingSessionId !== tokenSession.id) {
      const parentSession = await prisma.diningSession.findUnique({
        where: { id: billing.ctx.billingSessionId },
        include: menuInclude,
      });
      if (!parentSession || parentSession.status !== "open") {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      session = parentSession;
    }
    if (session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }

    const includedSingleIds = new Set<string>();
    const gcForCourse = session.guestCount;
    if (session.courseId) {
      const linkRows = await prisma.courseMenuItem.findMany({
        where: { courseId: session.courseId },
        include: { menuItem: { select: { id: true, sellKind: true } } },
      });
      for (const row of linkRows) {
        if (
          row.menuItem &&
          row.menuItem.sellKind !== "set" &&
          gcForCourse >= row.minGuestCount
        ) {
          includedSingleIds.add(row.menuItemId);
        }
      }
      const purchasedPackIds = parsePurchasedCourseOptionPackIds(session.purchasedCourseOptionPackIds);
      if (purchasedPackIds.length > 0) {
        const pim = await prisma.courseOptionPackMenuItem.findMany({
          where: {
            packId: { in: purchasedPackIds },
            pack: { courseId: session.courseId },
          },
          include: { menuItem: { select: { sellKind: true } } },
        });
        for (const r of pim) {
          if (r.menuItem && r.menuItem.sellKind !== "set") includedSingleIds.add(r.menuItemId);
        }
      }
    }

    const storeRow = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);
    const gatePreview = evaluatePublicOrderGate(st, new Date());
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);

    const purchasedSet = new Set(parsePurchasedCourseOptionPackIds(session.purchasedCourseOptionPackIds));
    const gcMenu = Math.max(1, session.guestCount);
    let courseOptionPacksOut:
      | {
          id: string;
          name: string;
          chargeScope: "table_once" | "per_person_pick" | "per_person_all";
          extraPrice: number;
          extraPriceTaxMode: "inclusive" | "exclusive";
          /** table_once: 卓一括の税込額。per_person_* では未使用でよい */
          chargeTaxIncluded: number;
          /** 一人あたりの税込額（per_person_*） */
          unitChargeTaxIncluded: number;
          /** per_person_all: 延べ人数ぶんの税込合計 */
          totalIfAllGuestsTaxIncluded?: number;
          /** per_person_pick: 選択できる人数の上限 */
          maxSelectablePeople?: number;
          purchased: boolean;
        }[]
      | undefined;
    if (session.courseId) {
      const packRows = await prisma.courseOptionPack.findMany({
        where: { courseId: session.courseId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          chargeScope: true,
          extraPrice: true,
          extraPriceTaxMode: true,
        },
      });
      if (packRows.length > 0) {
        courseOptionPacksOut = packRows.map((p) => {
          const tm = p.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
          const unitTi = courseOptionPackChargeTaxIncluded(p.extraPrice, tm, st.taxRatePercent);
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
    }

    const tierForLo = session.coursePriceTier;
    const lastOrder =
      session.courseId && session.course && tierForLo
        ? (() => {
            const p = computeGuestLastOrderPayload(
              session.openedAt,
              tierForLo.durationMinutes,
              st.guestCourseLastOrderMinutesBeforeEnd,
              st.guestLastOrderAfterDeadlinePolicy,
            );
            if (!p) return null;
            return {
              ...p,
              minutesBeforeEnd: st.guestCourseLastOrderMinutesBeforeEnd,
            };
          })()
        : null;

    const categories = await prisma.menuCategory.findMany({
      where: { storeId: session.storeId, visibleToGuest: true },
      orderBy: { sortOrder: "asc" },
      include: {
        guestVisibleTimeWindow: true,
        items: {
          where: {
            isAvailable: true,
          },
          orderBy: { sortOrder: "asc" },
          include: {
            timeDiscounts: {
              include: { timeWindow: { select: { startMin: true, endMin: true } } },
            },
            optionLinks: {
              orderBy: { sortOrder: "asc" },
              include: {
                optionGroup: {
                  include: {
                    items: { orderBy: { sortOrder: "asc" } },
                  },
                },
              },
            },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    componentMenuItem: {
                      select: {
                        id: true,
                        name: true,
                        isAvailable: true,
                        stockQty: true,
                        stockLowThreshold: true,
                        containsAlcohol: true,
                        allowTakeout: true,
                        category: {
                          include: { guestVisibleTimeWindow: true },
                        },
                        optionLinks: {
                          orderBy: { sortOrder: "asc" },
                          include: {
                            optionGroup: {
                              include: {
                                items: { orderBy: { sortOrder: "asc" } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const categoriesFiltered = categories.filter((c) => {
      if (c.items.length === 0) return false;
      const w = c.guestVisibleTimeWindow;
      const slice = w ? { startMin: w.startMin, endMin: w.endMin } : null;
      return categoryGuestVisibleAt(c, slice, nowMin);
    });

    const tier = session.coursePriceTier;
    const courseOut =
      session.course && tier
      ? {
          id: session.course.id,
          name: session.course.name,
          kind: session.course.kind,
          durationMinutes: tier.durationMinutes,
          pricePerPerson: tier.pricePerPerson,
          childPricePerPerson: tier.childPricePerPerson,
          priceTierId: tier.id,
          restrictedToMenuItems: false,
          pricingHint:
            includedSingleIds.size > 0
              ? "コース対象の単品はコース料に含まれます。対象外の単品・セットは追加料金です。"
              : "コース対象の単品が未設定のため、メニュー表記上はすべて追加料金扱いです。",
          ...(courseOptionPacksOut && courseOptionPacksOut.length > 0
            ? { optionPacks: courseOptionPacksOut }
            : {}),
        }
      : null;

    const seatCode = typeof session.table?.publicCode === "string" ? session.table.publicCode : "";
    const tableDisplayCode = seatCode ? displayTableCode(seatCode) || seatCode : "";

    return {
      orderGate: {
        acceptingOrders: gatePreview.accepting,
        reasonCode: gatePreview.reasonCode,
        messageJa: gatePreview.accepting ? "" : gatePreview.messageJa,
      },
      session: {
        id: session.id,
        guestCount: session.guestCount,
        childCount: session.childCount,
        guestAlcoholAllowed: session.guestAlcoholAllowed,
        course: courseOut,
        tableDisplayCode: tableDisplayCode || null,
      },
      lastOrder,
      customerProfile: session.customer
        ? { name: session.customer.name, phone: session.customer.phone }
        : null,
      store: {
        showMenuPrices: st.guestShowMenuPrices,
        menuPriceTaxMode: st.menuPriceTaxMode,
        coursePriceTaxMode: st.coursePriceTaxMode,
        taxRatePercent: st.taxRatePercent,
        guestCourseIncludedChargeOptionExtras: st.guestCourseIncludedChargeOptionExtras,
        guestCourseIncludedAllowTakeout: st.guestCourseIncludedAllowTakeout,
        guestCourseAddonAllowTakeout: st.guestCourseAddonAllowTakeout,
        guestShowEatModeTaxNote: st.guestShowEatModeTaxNote,
        guestCourseMenuNotice: st.guestCourseMenuNotice,
        guestServeLaterBlockTitle: st.guestServeLaterBlockTitle,
        guestServeLaterSelectPlaceholder: st.guestServeLaterSelectPlaceholder,
        guestServeLaterWithMealLabel: st.guestServeLaterWithMealLabel,
        guestServeLaterPairDrinkDessertLabel: st.guestServeLaterPairDrinkDessertLabel,
        guestServeLaterPerStepOptionFormat: st.guestServeLaterPerStepOptionFormat,
        guestServeLaterSingleRadioDeferFormat: st.guestServeLaterSingleRadioDeferFormat,
        guestServeLaterHelpSingle: st.guestServeLaterHelpSingle,
        guestServeLaterHelpMulti: st.guestServeLaterHelpMulti,
        requireCourseWhenStartingSession: st.requireCourseWhenStartingSession,
      },
      categories: categoriesFiltered.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
        items: c.items
          .map((it) => {
            if (it.sellKind === "set") {
              const row = mapGuestSetMenuItem(
                it as never,
                st.menuPriceTaxMode,
                st.taxRatePercent,
                nowMin,
              );
              if (!row) return null;
              let allowTakeoutOut = (row as { allowTakeout?: boolean }).allowTakeout === true;
              if (session.courseId && !st.guestCourseAddonAllowTakeout) allowTakeoutOut = false;
              return { ...row, courseTier: "addon" as const, allowTakeout: allowTakeoutOut };
            }
            const single = mapGuestMenuItem(it, st.menuPriceTaxMode, st.taxRatePercent, nowMin);
            const opt = mapGuestOptionGroups(it.optionLinks ?? []);
            if (opt.length) (single as Record<string, unknown>).optionGroups = opt;
            const courseTier =
              session.courseId == null
                ? null
                : includedSingleIds.has(it.id)
                  ? ("included" as const)
                  : ("addon" as const);
            let allowTakeoutOut = (single as { allowTakeout?: boolean }).allowTakeout === true;
            if (session.courseId && courseTier === "included" && !st.guestCourseIncludedAllowTakeout) {
              allowTakeoutOut = false;
            }
            if (session.courseId && courseTier === "addon" && !st.guestCourseAddonAllowTakeout) {
              allowTakeoutOut = false;
            }
            return { ...single, courseTier, allowTakeout: allowTakeoutOut };
          })
          .filter(Boolean),
      })),
    };
  });

  /**
   * スタッフ呼出（ゲスト端末→受付/管理画面へアナウンス）
   * - 受付システムの callReserved を立てる（確認されるまで表示/鳴動）
   */
  app.post<{ Params: { token: string } }>("/guest/:token/call-staff", async (req, reply) => {
    const sess = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      select: {
        storeId: true,
        status: true,
        mergedIntoSessionId: true,
        table: { select: { publicCode: true } },
      },
    });
    if (!sess) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    if (sess.status !== "open" && sess.status !== "merged") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const seatCode = typeof sess.table?.publicCode === "string" ? sess.table.publicCode : "";
    const callSeat = seatCode ? displayTableCode(seatCode) || seatCode : "";
    await prisma.receptionConfig.upsert({
      where: { storeId: sess.storeId },
      create: { storeId: sess.storeId },
      update: {},
    });
    await prisma.receptionState.upsert({
      where: { storeId: sess.storeId },
      create: { storeId: sess.storeId, callReserved: true, callType: callSeat ? `guest:${callSeat}` : "guest" },
      update: { callReserved: true, callType: callSeat ? `guest:${callSeat}` : "guest" },
    });
    return { ok: true };
  });

  /** 飲酒確認の結果をセッションに保存（酒類注文のサーバ側検証に使用） */
  app.post<{ Params: { token: string }; Body: { allowAlcohol?: unknown } }>(
    "/guest/:token/alcohol-ack",
    async (req, reply) => {
      const v = req.body?.allowAlcohol;
      if (typeof v !== "boolean") {
        return reply.code(400).send({ error: "allowAlcohol must be boolean" });
      }
      const sess = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
        select: { id: true, status: true, storeId: true, tableId: true, mergedIntoSessionId: true },
      });
      if (!sess) {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      const billing = await resolveGuestBillingContext(sess);
      if (!billing.ok) {
        return reply.code(billing.status).send(billing.body);
      }
      await prisma.diningSession.update({
        where: { id: billing.ctx.billingSessionId },
        data: { guestAlcoholAllowed: v },
      });
      return { ok: true };
    },
  );

  /**
   * 端末IDで匿名会員を紐づけ。初回紐づけで visitCount 加算。名前・電話は任意。
   */
  app.post<{
    Params: { token: string };
    Body: { deviceId?: string; name?: string | null; phone?: string | null };
  }>("/guest/:token/identify", async (req, reply) => {
    const deviceId = req.body?.deviceId;
    if (typeof deviceId !== "string" || !DEVICE_ID_RE.test(deviceId)) {
      return reply.code(400).send({ error: "deviceId must be 8-128 chars [A-Za-z0-9_-]" });
    }
    const bodyObj = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const hasName = "name" in bodyObj;
    const hasPhone = "phone" in bodyObj;
    const { name, phone } = normalizeOptionalProfile(bodyObj.name, bodyObj.phone);

    const preSess = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      select: { id: true, status: true, storeId: true, tableId: true, mergedIntoSessionId: true },
    });
    if (!preSess) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    if (preSess.status !== "open" && preSess.status !== "merged") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const preBilling = await resolveGuestBillingContext(preSess);
    if (!preBilling.ok) {
      return reply.code(preBilling.status).send(preBilling.body);
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { guestToken: req.params.token },
          select: { id: true, status: true, storeId: true, tableId: true, mergedIntoSessionId: true, customerId: true },
        });
        if (!sess || (sess.status !== "open" && sess.status !== "merged")) {
          const e = new Error("NO_SESSION");
          throw e;
        }
        const billing = await resolveGuestBillingContext(sess);
        if (!billing.ok) {
          const e = new Error("NO_SESSION");
          throw e;
        }
        const targetId = billing.ctx.billingSessionId;

        const target = await tx.diningSession.findUnique({ where: { id: targetId } });
        if (!target || target.status !== "open") {
          const e = new Error("NO_SESSION");
          throw e;
        }

        const customer = await tx.customer.upsert({
          where: { storeId_deviceId: { storeId: sess.storeId, deviceId } },
          create: {
            storeId: sess.storeId,
            deviceId,
            name: hasName ? name : null,
            phone: hasPhone ? phone : null,
            lastSeenAt: new Date(),
          },
          update: {
            lastSeenAt: new Date(),
            ...(hasName ? { name } : {}),
            ...(hasPhone ? { phone } : {}),
          },
        });

        if (target.customerId != null && target.customerId !== customer.id) {
          const e = new Error("DEVICE_CONFLICT");
          throw e;
        }

        if (target.customerId == null) {
          await tx.diningSession.update({
            where: { id: targetId },
            data: { customerId: customer.id },
          });
          const updated = await tx.customer.update({
            where: { id: customer.id },
            data: { visitCount: { increment: 1 } },
          });
          return { customer: updated, firstLink: true, visitCount: updated.visitCount };
        }

        const updated = await tx.customer.update({
          where: { id: customer.id },
          data: {
            lastSeenAt: new Date(),
            ...(hasName ? { name } : {}),
            ...(hasPhone ? { phone } : {}),
          },
        });
        return { customer: updated, firstLink: false, visitCount: updated.visitCount };
      });

      return {
        ok: true,
        customer: {
          name: result.customer.name,
          phone: result.customer.phone,
          visitCount: result.visitCount,
          firstLinkThisSession: result.firstLink,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "NO_SESSION") return reply.code(404).send({ error: "session not found or closed" });
      if (msg === "DEVICE_CONFLICT") {
        return reply.code(409).send({ error: "この卓のセッションは既に別端末で紐づいています" });
      }
      throw e;
    }
  });

  app.post<{
    Params: { token: string };
    Body: {
      lines: {
        menuItemId: string;
        qty: number;
        note?: string;
        eatMode?: EatMode;
        setSelections?: GuestSetStepSelection[];
        optionSelections?: GuestOptionGroupSelection[];
        /** セット構成単品のオプション（stepId + menuItemId） */
        setComponentOptionSelections?: {
          stepId: string;
          menuItemId: string;
          optionSelections?: GuestOptionGroupSelection[];
        }[];
        /** セットで「後から提供」にしたステップ id（メニューで allowServeLaterSplit な項目のみ） */
        serveLaterDeferStepId?: string;
        /** 複数ステップを後からにする場合（配列があれば単体より優先） */
        serveLaterDeferStepIds?: string[];
        /** ドリンク＋デザート同時後出しオプション選択時は true（グループ検証用） */
        serveLaterDeferPairDrinkDessert?: boolean;
      }[];
      note?: string;
      /** 同一卓内で端末を区別する ID（optional） */
      guestDeviceId?: string;
    };
  }>("/guest/:token/orders", async (req, reply) => {
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: { course: true, coursePriceTier: true },
    });
    if (!tokenSession) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const billing = await resolveGuestBillingContext(tokenSession);
    if (!billing.ok) {
      return reply.code(billing.status).send(billing.body);
    }
    let billSession = tokenSession;
    if (billing.ctx.billingSessionId !== tokenSession.id) {
      const parentS = await prisma.diningSession.findUnique({
        where: { id: billing.ctx.billingSessionId },
        include: { course: true, coursePriceTier: true },
      });
      if (!parentS || parentS.status !== "open") {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      billSession = parentS;
    }

    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: "lines[] required" });
    }

    const storeRow = await prisma.store.findUnique({
      where: { id: billSession.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);
    const gate = evaluatePublicOrderGate(st, new Date());
    if (!gate.accepting) {
      return reply.code(403).send({ error: gate.messageJa });
    }
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);
    const storeTaxRatePercent = st.taxRatePercent;

    if (billSession.courseId && billSession.course && billSession.coursePriceTier) {
      const lo = computeGuestLastOrderPayload(
        billSession.openedAt,
        billSession.coursePriceTier.durationMinutes,
        st.guestCourseLastOrderMinutesBeforeEnd,
        st.guestLastOrderAfterDeadlinePolicy,
      );
      if (lo?.pastDeadline) {
        const pol = st.guestLastOrderAfterDeadlinePolicy;
        if (pol === "block_all") {
          return reply.code(403).send({ error: "ラストオーダーの時間を過ぎています" });
        }
        if (pol === "singles_only") {
          for (const raw of lines) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
            const row = raw as { setSelections?: unknown };
            const sel = Array.isArray(row.setSelections) ? row.setSelections : [];
            if (sel.length > 0) {
              return reply
                .code(403)
                .send({ error: "ラストオーダー後はセットをご注文いただけません（単品のみご利用いただけます）" });
            }
          }
        }
      }
    }

    const billingId = billing.ctx.billingSessionId;
    const orderSourceTableId = billing.ctx.orderSourceTableId;
    const orderStoreId = billSession.storeId;

    const bodyOrder = req.body as { guestDeviceId?: unknown };
    const guestDeviceId =
      typeof bodyOrder.guestDeviceId === "string" && bodyOrder.guestDeviceId.trim().length >= 4
        ? bodyOrder.guestDeviceId.trim().slice(0, 128)
        : undefined;

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { id: billingId },
          include: {
            table: { select: { name: true, publicCode: true } },
            course: {
              include: { includedItems: { select: { menuItemId: true } } },
            },
          },
        });
        const includedSingles = new Set<string>();
        const gcOrd = sess?.guestCount ?? 0;
        if (sess?.courseId) {
          const linkRows = await tx.courseMenuItem.findMany({
            where: { courseId: sess.courseId },
            include: { menuItem: { select: { sellKind: true } } },
          });
          for (const row of linkRows) {
            if (
              row.menuItem &&
              row.menuItem.sellKind !== "set" &&
              gcOrd >= row.minGuestCount
            ) {
              includedSingles.add(row.menuItemId);
            }
          }
          const purchasedOrd = parsePurchasedCourseOptionPackIds(sess?.purchasedCourseOptionPackIds);
          if (purchasedOrd.length > 0 && sess.courseId) {
            const pim = await tx.courseOptionPackMenuItem.findMany({
              where: {
                packId: { in: purchasedOrd },
                pack: { courseId: sess.courseId },
              },
              include: { menuItem: { select: { sellKind: true } } },
            });
            for (const r of pim) {
              if (r.menuItem && r.menuItem.sellKind !== "set") includedSingles.add(r.menuItemId);
            }
          }
        }

        const needStock = new Map<string, number>();

        type ResolvedSingle = {
          kind: "single";
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice?: number;
          nameSnapshot?: string;
          lineExtra?: Record<string, unknown>;
          eatMode: EatMode;
          taxRatePercent: number;
        };
        type ResolvedSet = {
          kind: "set";
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice: number;
          nameSnapshot: string;
          lineExtra: Record<string, unknown>;
          eatMode: EatMode;
          taxRatePercent: number;
        };
        const resolved: (ResolvedSingle | ResolvedSet)[] = [];

        for (const l of lines) {
          if (typeof l.qty !== "number" || l.qty < 1 || !Number.isInteger(l.qty)) {
            throw new Error("BAD_QTY");
          }
          const sel = Array.isArray(l.setSelections) ? l.setSelections : [];
          const hasSetPayload = sel.length > 0;
          const eatMode = normalizeEatMode((l as { eatMode?: unknown }).eatMode);
          const taxRatePercent = eatModeTaxRatePercent(eatMode, storeTaxRatePercent);

          if (hasSetPayload) {
            const setItem = await tx.menuItem.findFirst({
              where: {
                id: l.menuItemId,
                isAvailable: true,
                sellKind: "set",
                category: { storeId: orderStoreId, visibleToGuest: true },
              },
              include: {
                category: { include: { guestVisibleTimeWindow: true } },
                timeDiscounts: {
                  include: { timeWindow: { select: { startMin: true, endMin: true } } },
                },
                setSteps: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    choices: {
                      orderBy: { sortOrder: "asc" },
                      include: {
                        componentMenuItem: {
                          include: {
                            category: { include: { guestVisibleTimeWindow: true } },
                            optionLinks: {
                              orderBy: { sortOrder: "asc" },
                              include: {
                                optionGroup: { include: { items: { orderBy: { sortOrder: "asc" } } } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            });
            if (!setItem) throw new Error("BAD_ITEM");
            if (eatMode === "takeout" && setItem.allowTakeout !== true) throw new Error("BAD_TAKEOUT");
            if (eatMode === "takeout" && sess?.courseId && !st.guestCourseAddonAllowTakeout) {
              throw new Error("BAD_TAKEOUT_COURSE");
            }
            const sc = setItem.category;
            const gw0 = sc.guestVisibleTimeWindow;
            const sl0 = gw0 ? { startMin: gw0.startMin, endMin: gw0.endMin } : null;
            if (!categoryGuestVisibleAt(sc, sl0, nowMin)) throw new Error("BAD_ITEM_TIME");
            if (setItem.containsAlcohol && sess?.guestAlcoholAllowed !== true) {
              throw new Error("ALCOHOL_DENIED");
            }

            const stepsVal: SetStepForValidation[] = setItem.setSteps.map((st) => ({
              id: st.id,
              label: st.label,
              minPick: st.minPick,
              maxPick: st.maxPick,
              choices: st.choices.map((c) => ({
                componentMenuItemId: c.componentMenuItemId,
                extraPrice: c.extraPrice,
                isFixed: c.isFixed === true,
              })),
            }));

            const validated = validateSetSelections(stepsVal, sel);
            if (!validated.ok) throw new Error("BAD_SET");
            const { byStep } = validated;

            const setComponentOptionSelectionsRaw = (l as { setComponentOptionSelections?: unknown }).setComponentOptionSelections;
            const setCompOptRows: Array<{ stepId: string; menuItemId: string; optionSelections: unknown }> = [];
            if (Array.isArray(setComponentOptionSelectionsRaw)) {
              for (const row of setComponentOptionSelectionsRaw) {
                if (!row || typeof row !== "object") continue;
                const stepId = typeof (row as { stepId?: unknown }).stepId === "string" ? (row as { stepId: string }).stepId.trim() : "";
                const menuItemId =
                  typeof (row as { menuItemId?: unknown }).menuItemId === "string"
                    ? (row as { menuItemId: string }).menuItemId.trim()
                    : "";
                if (!stepId || !menuItemId) continue;
                setCompOptRows.push({
                  stepId,
                  menuItemId,
                  optionSelections: (row as { optionSelections?: unknown }).optionSelections,
                });
              }
            }

            // セットの構成単品は「セットの一部」として扱う（ゲストメニュー表示と同様、
            // カテゴリの visibleToGuest / 時間帯で弾かない。販売可否と酒類のみ検証）
            for (const st of setItem.setSteps) {
              const picked = byStep.get(st.id) ?? [];
              for (const compId of picked) {
                const ch = st.choices.find((c) => c.componentMenuItemId === compId);
                if (!ch) throw new Error("BAD_SET");
                const comp = ch.componentMenuItem;
                if (!comp.isAvailable) throw new Error("BAD_ITEM");
                if (comp.containsAlcohol && sess?.guestAlcoholAllowed !== true) {
                  throw new Error("ALCOHOL_DENIED");
                }
              }
            }

            const priceTaxMode = setItem.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseNet = baseNetFromStoredPrice(setItem.price, priceTaxMode, storeTaxRatePercent);
            const baseTaxIncluded = taxIncludedFromNet(baseNet, taxRatePercent);
            let surcharge = 0;
            for (const st of setItem.setSteps) {
              const picked = byStep.get(st.id) ?? [];
              const def = stepsVal.find((x) => x.id === st.id)!;
              surcharge += surchargeExclusiveStepSumInclusive(def, picked, taxRatePercent);
            }

            // セット構成単品のオプション（単品 option priceDelta をセット単価に加算）
            const compOptLineExtraByKey = new Map<string, Record<string, unknown>>();
            for (const row of setCompOptRows) {
              const stepRow = setItem.setSteps.find((s) => s.id === row.stepId);
              if (!stepRow) throw new Error("BAD_SET_COMP_OPT");
              const pickedIds = byStep.get(row.stepId) ?? [];
              const fixedIds = stepRow.choices.filter((c) => c.isFixed === true).map((c) => c.componentMenuItemId);
              const allowedPicked = new Set([...fixedIds, ...pickedIds]);
              if (!allowedPicked.has(row.menuItemId)) throw new Error("BAD_SET_COMP_OPT");
              const ch = stepRow.choices.find((c) => c.componentMenuItemId === row.menuItemId);
              if (!ch) throw new Error("BAD_SET_COMP_OPT");
              const comp = ch.componentMenuItem;
              const linkedGroupsRaw = (comp.optionLinks || [])
                .map((ol) => ol.optionGroup)
                .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
                .map((g) => ({
                  id: g.id,
                  name: g.name,
                  minSelect: g.minSelect,
                  maxSelect: g.maxSelect,
                  items: g.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
                }))
                .filter((g) => g.items.length > 0);
              const linkedGroups = linkedGroupsRaw.map((g) => ({
                ...g,
                items: g.items.map((it) => ({
                  ...it,
                  priceDelta: retaxInclusiveYen(it.priceDelta, storeTaxRatePercent, taxRatePercent),
                })),
              }));
              const vOpt = validateGuestOptionSelections(linkedGroups, row.optionSelections);
              if (!vOpt.ok) throw new Error("BAD_SET_COMP_OPT");
              surcharge += sumInclusiveOptionPriceDelta(linkedGroups, vOpt.byGroup);
              const extra = buildSingleOptionsLineExtra(linkedGroups, vOpt.byGroup);
              if (Array.isArray(extra.options) && extra.options.length) {
                compOptLineExtraByKey.set(`${row.stepId}::${row.menuItemId}`, extra);
              }
            }

            const discRows = setItem.timeDiscounts.map((d) => ({
              discountKind: d.discountKind,
              value: d.value,
              timeWindow: d.timeWindow,
            }));
            const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);
            const unitPrice = discountedBase + surcharge;

            const nameById = new Map<string, string>();
            for (const st of setItem.setSteps) {
              for (const ch of st.choices) {
                nameById.set(ch.componentMenuItemId, ch.componentMenuItem.name);
              }
            }

            const lineObj = l as Record<string, unknown>;
            const serveLaterDeferStepIds = parseGuestServeLaterDeferStepIds(lineObj);
            const pairDd = lineObj.serveLaterDeferPairDrinkDessert === true;
            for (const sid of serveLaterDeferStepIds) {
              const row = setItem.setSteps.find((s) => s.id === sid);
              if (!row || row.allowServeLaterSplit !== true) {
                throw new Error("BAD_SERVE_LATER");
              }
            }
            if (pairDd) {
              if (serveLaterDeferStepIds.length !== 2) throw new Error("BAD_SERVE_LATER");
              const r0 = setItem.setSteps.find((s) => s.id === serveLaterDeferStepIds[0]);
              const r1 = setItem.setSteps.find((s) => s.id === serveLaterDeferStepIds[1]);
              if (!r0 || !r1) throw new Error("BAD_SERVE_LATER");
              const g0 = normalizeServeLaterGroupStored(r0.serveLaterGroup);
              const g1 = normalizeServeLaterGroupStored(r1.serveLaterGroup);
              const okPair =
                (g0 === "drink" && g1 === "dessert") || (g0 === "dessert" && g1 === "drink");
              if (!okPair) throw new Error("BAD_SERVE_LATER");
            }

            const hasDefer = serveLaterDeferStepIds.length > 0;
            const bundleId = hasDefer ? randomUUID() : "";
            let lineExtra: Record<string, unknown>;
            let nameSnapshot: string;
            if (hasDefer) {
              const omit = new Set(serveLaterDeferStepIds);
              lineExtra = buildSetLineExtraOmitStepIds(
                setItem.setSteps.map((s) => ({ id: s.id, label: s.label })),
                byStep,
                nameById,
                stepsVal,
                storeTaxRatePercent,
                omit,
              );
              lineExtra.bundleId = bundleId;
              const sortedDeferIds = [...serveLaterDeferStepIds].sort();
              lineExtra.serveLaterDeferredStepIds = sortedDeferIds;
              lineExtra.serveLaterDeferredStepId = sortedDeferIds[0];
              const labels = sortedDeferIds.map(
                (id) => setItem.setSteps.find((s) => s.id === id)?.label ?? "",
              );
              lineExtra.serveLaterDeferredStepLabels = labels;
              lineExtra.serveLaterDeferredStepLabel =
                labels.filter(Boolean).join("・") || sortedDeferIds[0];
              nameSnapshot = buildSetNameSnapshot(setItem.name, lineExtra);
            } else {
              lineExtra = buildSetLineExtra(
                setItem.setSteps.map((s) => ({ id: s.id, label: s.label })),
                byStep,
                nameById,
                stepsVal,
                storeTaxRatePercent,
              );
              nameSnapshot = buildSetNameSnapshot(setItem.name, lineExtra);
            }

            // セット lineExtra に「構成単品のオプションスナップショット」を埋め込む（表示用）
            try {
              const stepsAny = (lineExtra as { steps?: unknown }).steps;
              if (Array.isArray(stepsAny) && compOptLineExtraByKey.size > 0) {
                for (const stEx of stepsAny) {
                  if (!stEx || typeof stEx !== "object") continue;
                  const stepId =
                    typeof (stEx as { stepId?: unknown }).stepId === "string"
                      ? (stEx as { stepId: string }).stepId
                      : "";
                  const picksAny = (stEx as { picks?: unknown }).picks;
                  if (!stepId || !Array.isArray(picksAny)) continue;
                  for (const p of picksAny) {
                    if (!p || typeof p !== "object") continue;
                    const mid =
                      typeof (p as { menuItemId?: unknown }).menuItemId === "string"
                        ? (p as { menuItemId: string }).menuItemId
                        : "";
                    if (!mid) continue;
                    const extra = compOptLineExtraByKey.get(`${stepId}::${mid}`);
                    if (extra) (p as Record<string, unknown>).optionExtra = extra;
                  }
                }
              }
            } catch (_) {}

            needStock.set(setItem.id, (needStock.get(setItem.id) ?? 0) + l.qty);
            for (const st of setItem.setSteps) {
              const picked = byStep.get(st.id) ?? [];
              for (const compId of picked) {
                needStock.set(compId, (needStock.get(compId) ?? 0) + l.qty);
              }
            }

            resolved.push({
              kind: "set",
              menuItemId: setItem.id,
              qty: l.qty,
              note: l.note?.trim() || null,
              unitPrice,
              nameSnapshot,
              lineExtra,
              eatMode,
              taxRatePercent,
            });

            if (hasDefer) {
              for (const deferId of serveLaterDeferStepIds) {
                const deferRow = setItem.setSteps.find((s) => s.id === deferId)!;
                const deferStepLabel = deferRow.label;
                const deferPicked = byStep.get(deferId) ?? [];
                for (const compId of deferPicked) {
                  const compName = nameById.get(compId) ?? "（名称未設定）";
                  const childNameSnapshot = `${setItem.name}（後出し）› ${deferStepLabel}: ${compName}`;
                  resolved.push({
                    kind: "single",
                    menuItemId: compId,
                    qty: l.qty,
                    note: l.note?.trim() || null,
                    unitPrice: 0,
                    nameSnapshot: childNameSnapshot,
                    lineExtra: {
                      kind: SET_SERVE_LATER_LINE_KIND,
                      bundleId,
                      setMenuItemId: setItem.id,
                      deferredStepId: deferId,
                      stepLabel: deferStepLabel,
                    },
                    eatMode,
                    taxRatePercent,
                  });
                }
              }
            }
          } else {
            const plainItem = await tx.menuItem.findFirst({
              where: {
                id: l.menuItemId,
                isAvailable: true,
                sellKind: "single",
                category: { storeId: orderStoreId, visibleToGuest: true },
              },
              include: {
                category: { include: { guestVisibleTimeWindow: true } },
                timeDiscounts: {
                  include: { timeWindow: { select: { startMin: true, endMin: true } } },
                },
                optionLinks: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    optionGroup: {
                      include: {
                        items: { orderBy: { sortOrder: "asc" } },
                      },
                    },
                  },
                },
              },
            });
            if (!plainItem) throw new Error("BAD_ITEM");
            if (eatMode === "takeout" && plainItem.allowTakeout !== true) throw new Error("BAD_TAKEOUT");
            if (eatMode === "takeout" && sess?.courseId) {
              const inc = includedSingles.has(plainItem.id);
              if (inc && !st.guestCourseIncludedAllowTakeout) throw new Error("BAD_TAKEOUT_COURSE");
              if (!inc && !st.guestCourseAddonAllowTakeout) throw new Error("BAD_TAKEOUT_COURSE");
            }
            const cat0 = plainItem.category;
            const gw0 = cat0.guestVisibleTimeWindow;
            const sl0 = gw0 ? { startMin: gw0.startMin, endMin: gw0.endMin } : null;
            if (!categoryGuestVisibleAt(cat0, sl0, nowMin)) throw new Error("BAD_ITEM_TIME");
            if (plainItem.containsAlcohol && sess?.guestAlcoholAllowed !== true) {
              throw new Error("ALCOHOL_DENIED");
            }

            const linkedGroups = plainItem.optionLinks
              .map((ol) => ol.optionGroup)
              .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
              .map((g) => ({
                id: g.id,
                name: g.name,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                items: g.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
              }))
              .filter((g) => g.items.length > 0);

            const vOpt = validateGuestOptionSelections(linkedGroups, l.optionSelections);
            if (!vOpt.ok) throw new Error("BAD_OPTIONS");

            const priceTaxMode = plainItem.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseNet = baseNetFromStoredPrice(plainItem.price, priceTaxMode, storeTaxRatePercent);
            const baseTaxIncluded = taxIncludedFromNet(baseNet, taxRatePercent);
            const discRows0 = plainItem.timeDiscounts.map((d) => ({
              discountKind: d.discountKind,
              value: d.value,
              timeWindow: d.timeWindow,
            }));
            const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows0, nowMin);
            const inCourseIncluded =
              Boolean(sess?.courseId && includedSingles.has(plainItem.id));
            const effectiveBase = inCourseIncluded ? 0 : discountedBase;
            const chargeOptExtras = st.guestCourseIncludedChargeOptionExtras !== false;
            const linkedGroupsTaxed = linkedGroups.map((g) => ({
              ...g,
              items: g.items.map((it) => ({
                ...it,
                priceDelta: retaxInclusiveYen(it.priceDelta, storeTaxRatePercent, taxRatePercent),
              })),
            }));
            const optSum =
              inCourseIncluded && !chargeOptExtras
                ? 0
                : sumInclusiveOptionPriceDelta(linkedGroupsTaxed, vOpt.byGroup);
            const unitPriceWithOpts = effectiveBase + optSum;
            const lineExtraOpts = buildSingleOptionsLineExtra(linkedGroupsTaxed, vOpt.byGroup);
            const optArr = lineExtraOpts.options;
            const hasOptDetail = Array.isArray(optArr) && optArr.length > 0;

            needStock.set(l.menuItemId, (needStock.get(l.menuItemId) ?? 0) + l.qty);
            resolved.push({
              kind: "single",
              menuItemId: l.menuItemId,
              qty: l.qty,
              note: l.note?.trim() || null,
              ...(hasOptDetail
                ? {
                    unitPrice: unitPriceWithOpts,
                    nameSnapshot: buildSingleNameSnapshotWithOptions(plainItem.name, lineExtraOpts),
                    lineExtra: lineExtraOpts,
                  }
                : {
                    unitPrice: effectiveBase,
                    nameSnapshot: plainItem.name,
                  }),
              eatMode,
              taxRatePercent,
            });
          }
        }

        const itemCache = new Map<
          string,
          { id: string; name: string; price: number; stockQty: number | null; priceTaxMode: string }
        >();
        for (const [menuItemId, needQty] of needStock) {
          const item = await tx.menuItem.findFirst({
            where: {
              id: menuItemId,
              isAvailable: true,
              // セット構成単品はゲスト非表示カテゴリでも在庫確認に載る（トップレベル商品は上でゲスト可否済み）
              category: { storeId: orderStoreId },
            },
            include: {
              category: { include: { guestVisibleTimeWindow: true } },
              timeDiscounts: {
                include: { timeWindow: { select: { startMin: true, endMin: true } } },
              },
            },
          });
          if (!item) throw new Error("BAD_ITEM");
          if (item.stockQty !== null && item.stockQty < needQty) {
            throw new Error("BAD_STOCK");
          }
          const priceTaxMode = item.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
          const baseTaxIncluded =
            (item.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode) === "exclusive"
              ? Math.round(item.price * (1 + st.taxRatePercent / 100))
              : item.price;
          const discRows = item.timeDiscounts.map((d) => ({
            discountKind: d.discountKind,
            value: d.value,
            timeWindow: d.timeWindow,
          }));
          const { price: unitPrice } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);
          itemCache.set(menuItemId, {
            ...item,
            priceTaxMode,
            price: unitPrice,
          });
        }

        const so = await tx.salesOrder.create({
          data: {
            sessionId: billingId,
            ...(orderSourceTableId ? { sourceTableId: orderSourceTableId } : {}),
            status: "submitted",
            note: req.body?.note?.trim() || null,
          },
        });

        for (const r of resolved) {
          if (r.kind === "single") {
            const item = itemCache.get(r.menuItemId)!;
            const unitPrice = r.unitPrice ?? item.price;
            const nameSnapshot = r.nameSnapshot ?? item.name;
            const lineExtraJson = r.lineExtra ? (r.lineExtra as Prisma.InputJsonValue) : undefined;
            const initialStatus = isSetServeLaterLine(r.lineExtra)
              ? ORDER_LINE_STATUS_GUEST_DEFERRED
              : "queued";
            await tx.orderLine.create({
              data: {
                orderId: so.id,
                menuItemId: item.id,
                nameSnapshot,
                unitPrice,
                qty: r.qty,
                note: r.note,
                lineExtra: lineExtraJson,
                eatMode: r.eatMode,
                taxRatePercent: r.taxRatePercent,
                status: initialStatus,
                ...(guestDeviceId ? { guestDeviceId } : {}),
              },
            });
          } else {
            await tx.orderLine.create({
              data: {
                orderId: so.id,
                menuItemId: r.menuItemId,
                nameSnapshot: r.nameSnapshot,
                unitPrice: r.unitPrice,
                qty: r.qty,
                note: r.note,
                lineExtra: r.lineExtra as Prisma.InputJsonValue,
                eatMode: r.eatMode,
                taxRatePercent: r.taxRatePercent,
                status: "queued",
                ...(guestDeviceId ? { guestDeviceId } : {}),
              },
            });
          }
        }

        for (const [menuItemId, needQty] of needStock) {
          const it = itemCache.get(menuItemId)!;
          if (it.stockQty !== null) {
            await tx.menuItem.update({
              where: { id: menuItemId },
              data: { stockQty: { decrement: needQty } },
            });
          }
        }

        const guestTakeoutLines = resolved.filter((r) => r.eatMode === "takeout");
        if (guestTakeoutLines.length > 0) {
          const leadMs = Math.max(0, st.takeoutPickupMinLeadMinutes) * 60 * 1000;
          const pickupAt = new Date(Date.now() + leadMs);
          const tbl = sess?.table;
          const customerLabel =
            tbl && String(tbl.name || "").trim()
              ? String(tbl.name).trim()
              : "ゲスト卓テイクアウト";
          const linesPayload = resolved.map((r) => {
            if (r.kind === "single") {
              const item = itemCache.get(r.menuItemId)!;
              return {
                menuItemId: r.menuItemId,
                qty: r.qty,
                note: r.note,
                unitPrice: r.unitPrice ?? item.price,
                nameSnapshot: r.nameSnapshot ?? item.name,
                eatMode: r.eatMode,
                taxRatePercent: r.taxRatePercent,
                lineExtra: r.lineExtra ?? null,
              };
            }
            return {
              menuItemId: r.menuItemId,
              qty: r.qty,
              note: r.note,
              unitPrice: r.unitPrice,
              nameSnapshot: r.nameSnapshot,
              eatMode: r.eatMode,
              taxRatePercent: r.taxRatePercent,
              lineExtra: r.lineExtra ?? null,
            };
          });
          await tx.takeoutNetOrder.create({
            data: {
              storeId: orderStoreId,
              status: "new",
              pickupAt,
              salesOrderId: so.id,
              customerName: customerLabel,
              phone: "-",
              email: "-",
              note: req.body?.note?.trim() || null,
              lines: linesPayload as unknown as Prisma.InputJsonValue,
            },
          });
        }

        return tx.salesOrder.findUnique({
          where: { id: so.id },
          include: { lines: true },
        });
      });
      return order;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "invalid qty" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "invalid or unavailable menuItemId" });
      if (msg === "BAD_STOCK") return reply.code(400).send({ error: "insufficient stock" });
      if (msg === "BAD_ITEM_TIME") {
        return reply.code(400).send({ error: "この時間帯は注文できないカテゴリの商品が含まれています" });
      }
      if (msg === "BAD_SET") {
        return reply.code(400).send({ error: "セットの選択内容が正しくありません" });
      }
      if (msg === "BAD_SERVE_LATER") {
        return reply.code(400).send({ error: "「後から提供」の指定が不正です" });
      }
      if (msg === "ALCOHOL_DENIED") {
        return reply.code(403).send({ error: "酒類をご注文いただけません（確認が必要です）" });
      }
      if (msg === "BAD_OPTIONS") {
        return reply.code(400).send({ error: "オプションの選択内容が正しくありません" });
      }
      if (msg === "BAD_TAKEOUT") {
        return reply.code(400).send({ error: "テイクアウト不可の商品が含まれています" });
      }
      if (msg === "BAD_TAKEOUT_COURSE") {
        return reply
          .code(400)
          .send({ error: "このコース設定では、選択した区分ではテイクアウトできない商品が含まれています" });
      }
      if (msg === "BAD_SET_COMP_OPT") {
        return reply.code(400).send({ error: "セット構成単品のオプション選択が正しくありません" });
      }
      throw e;
    }
  });

  app.post<{
    Params: { token: string };
    Body: { packId?: string; peopleCount?: number };
  }>("/guest/:token/course-option-packs/purchase", async (req, reply) => {
    const bodyObj = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const packId = typeof bodyObj.packId === "string" ? bodyObj.packId : undefined;
    if (typeof packId !== "string" || !packId.trim()) {
      return reply.code(400).send({ error: "packId required" });
    }
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: { course: true, coursePriceTier: true },
    });
    if (!tokenSession) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const packBilling = await resolveGuestBillingContext(tokenSession);
    if (!packBilling.ok) {
      return reply.code(packBilling.status).send(packBilling.body);
    }
    let billSession = tokenSession;
    if (packBilling.ctx.billingSessionId !== tokenSession.id) {
      const parentS = await prisma.diningSession.findUnique({
        where: { id: packBilling.ctx.billingSessionId },
        include: { course: true, coursePriceTier: true },
      });
      if (!parentS || parentS.status !== "open") {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      billSession = parentS;
    }
    if (!billSession.courseId) {
      return reply.code(400).send({ error: "no course on this session" });
    }
    const pack = await prisma.courseOptionPack.findFirst({
      where: { id: packId.trim(), courseId: billSession.courseId },
    });
    if (!pack) {
      return reply.code(404).send({ error: "option pack not found" });
    }
    const storeRow0 = await prisma.store.findUnique({
      where: { id: billSession.storeId },
      select: { settings: true },
    });
    const st0 = mergeStoreSettings(storeRow0?.settings);
    if (billSession.courseId && billSession.course && billSession.coursePriceTier) {
      const lo = computeGuestLastOrderPayload(
        billSession.openedAt,
        billSession.coursePriceTier.durationMinutes,
        st0.guestCourseLastOrderMinutesBeforeEnd,
        st0.guestLastOrderAfterDeadlinePolicy,
      );
      if (lo?.pastDeadline && st0.guestLastOrderAfterDeadlinePolicy !== "allow_all") {
        return reply.code(403).send({ error: "ラストオーダーの時間を過ぎています" });
      }
    }
    const current = parsePurchasedCourseOptionPackIds(billSession.purchasedCourseOptionPackIds);
    if (current.includes(pack.id)) {
      return reply.code(409).send({ error: "すでに追加済みです" });
    }
    const scopePre = packChargeScopeFromDb(pack.chargeScope);
    const gcPre = Math.max(1, billSession.guestCount);
    let peopleCountPurchase: number | null = null;
    if (scopePre === "per_person_pick") {
      const pc = bodyObj.peopleCount;
      if (typeof pc !== "number" || !Number.isInteger(pc)) {
        return reply.code(400).send({ error: `人数は1〜${gcPre}の整数で指定してください` });
      }
      if (pc < 1 || pc > gcPre) {
        return reply.code(400).send({ error: `人数は1〜${gcPre}の整数で指定してください` });
      }
      peopleCountPurchase = pc;
    }

    const packBillingId = packBilling.ctx.billingSessionId;
    const packOrderSourceTableId = packBilling.ctx.orderSourceTableId;

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({ where: { id: packBillingId } });
        if (!sess || sess.status !== "open") throw new Error("SESSION_GONE");
        const cur = parsePurchasedCourseOptionPackIds(sess.purchasedCourseOptionPackIds);
        if (cur.includes(pack.id)) throw new Error("ALREADY");
        if (!sess.courseId) throw new Error("NO_COURSE");
        const packRow = await tx.courseOptionPack.findFirst({
          where: { id: pack.id, courseId: sess.courseId },
        });
        if (!packRow) throw new Error("PACK_GONE");
        const storeRowTx = await tx.store.findUnique({
          where: { id: sess.storeId },
          select: { settings: true },
        });
        const stTx = mergeStoreSettings(storeRowTx?.settings);
        const tm = packRow.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
        const unitPriceTaxInc = courseOptionPackChargeTaxIncluded(
          packRow.extraPrice,
          tm,
          stTx.taxRatePercent,
        );
        const scope = packChargeScopeFromDb(packRow.chargeScope);
        const gc = Math.max(1, sess.guestCount);
        let qty = 1;
        let unitPrice = unitPriceTaxInc;
        if (scope === "table_once") {
          qty = 1;
          unitPrice = unitPriceTaxInc;
        } else if (scope === "per_person_pick") {
          qty = peopleCountPurchase ?? 1;
          if (qty < 1 || qty > gc) throw new Error("BAD_PEOPLE");
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
            sessionId: packBillingId,
            ...(packOrderSourceTableId ? { sourceTableId: packOrderSourceTableId } : {}),
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
            purchasedCourseOptionPackIds: [...cur, pack.id],
          },
        });
        return tx.salesOrder.findUnique({
          where: { id: so.id },
          include: { lines: true },
        });
      });
      return order;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "SESSION_GONE") return reply.code(404).send({ error: "session not found or closed" });
      if (msg === "ALREADY") return reply.code(409).send({ error: "すでに追加済みです" });
      if (msg === "PACK_GONE" || msg === "NO_COURSE") {
        return reply.code(404).send({ error: "オプションが見つかりません" });
      }
      if (msg === "BAD_PEOPLE") {
        return reply.code(400).send({ error: "人数が無効です" });
      }
      throw e;
    }
  });

  app.get<{ Params: { token: string } }>("/guest/:token/orders", async (req, reply) => {
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      select: { id: true, status: true, storeId: true, tableId: true, mergedIntoSessionId: true },
    });
    if (!session) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const listBilling = await resolveGuestBillingContext(session);
    if (!listBilling.ok) {
      return reply.code(listBilling.status).send(listBilling.body);
    }
    const orders = await prisma.salesOrder.findMany({
      where: { sessionId: listBilling.ctx.billingSessionId },
      orderBy: { createdAt: "desc" },
      include: { lines: true },
    });
    const billingSessionRow = await prisma.diningSession.findUnique({
      where: { id: listBilling.ctx.billingSessionId },
      select: {
        course: { select: { id: true, name: true } },
      },
    });
    return {
      orders,
      sessionCourse: billingSessionRow?.course
        ? { id: billingSessionRow.course.id, name: billingSessionRow.course.name }
        : null,
    };
  });

  app.post<{ Params: { token: string; lineId: string } }>(
    "/guest/:token/deferred-lines/:lineId/send-kitchen",
    async (req, reply) => {
      const session = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
        select: { id: true, status: true, storeId: true, tableId: true, mergedIntoSessionId: true },
      });
      if (!session) {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      const billing = await resolveGuestBillingContext(session);
      if (!billing.ok) {
        return reply.code(billing.status).send(billing.body);
      }
      const lineId = typeof req.params.lineId === "string" ? req.params.lineId.trim() : "";
      if (!lineId) {
        return reply.code(400).send({ error: "invalid line id" });
      }
      const line = await prisma.orderLine.findFirst({
        where: {
          id: lineId,
          order: { sessionId: billing.ctx.billingSessionId },
        },
        select: { id: true, status: true, lineExtra: true },
      });
      if (!line) {
        return reply.code(404).send({ error: "line not found" });
      }
      if (!isSetServeLaterLine(line.lineExtra) || line.status !== ORDER_LINE_STATUS_GUEST_DEFERRED) {
        return reply.code(400).send({ error: "not a deferred serve-later line" });
      }
      await prisma.orderLine.update({
        where: { id: line.id },
        data: { status: "queued" },
      });
      return { ok: true };
    },
  );

  /**
   * ゲストメニューに出ていない ID（時間帯・カテゴリ非表示など）でも、注文履歴から再注文できるよう
   * 同一店舗の単品・セットをゲスト向け JSON 形で返す。
   */
  app.get<{ Params: { token: string }; Querystring: { ids?: string } }>(
    "/guest/:token/reorder-menu-items",
    async (req, reply) => {
      const menuInclude = {
        course: {
          include: { includedItems: { select: { menuItemId: true } } },
        },
        coursePriceTier: true,
      } as const;
      const tokenSession = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
        include: menuInclude,
      });
      if (!tokenSession) {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      const billing = await resolveGuestBillingContext(tokenSession);
      if (!billing.ok) {
        return reply.code(billing.status).send(billing.body);
      }
      let session = tokenSession;
      if (billing.ctx.billingSessionId !== tokenSession.id) {
        const parentSession = await prisma.diningSession.findUnique({
          where: { id: billing.ctx.billingSessionId },
          include: menuInclude,
        });
        if (!parentSession || parentSession.status !== "open") {
          return reply.code(404).send({ error: "session not found or closed" });
        }
        session = parentSession;
      }
      if (session.status !== "open") {
        return reply.code(404).send({ error: "session not found or closed" });
      }

      const raw = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
      const idList = [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 80);
      if (idList.length === 0) return { items: [] as Record<string, unknown>[] };

      const storeRow = await prisma.store.findUnique({
        where: { id: session.storeId },
        select: { settings: true },
      });
      const st = mergeStoreSettings(storeRow?.settings);
      const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);

      const includedSingleIds = new Set<string>();
      const gcForCourse = session.guestCount;
      if (session.courseId) {
        const linkRows = await prisma.courseMenuItem.findMany({
          where: { courseId: session.courseId },
          include: { menuItem: { select: { id: true, sellKind: true } } },
        });
        for (const row of linkRows) {
          if (
            row.menuItem &&
            row.menuItem.sellKind !== "set" &&
            gcForCourse >= row.minGuestCount
          ) {
            includedSingleIds.add(row.menuItemId);
          }
        }
        const purchasedPackIds = parsePurchasedCourseOptionPackIds(session.purchasedCourseOptionPackIds);
        if (purchasedPackIds.length > 0) {
          const pim = await prisma.courseOptionPackMenuItem.findMany({
            where: {
              packId: { in: purchasedPackIds },
              pack: { courseId: session.courseId },
            },
            include: { menuItem: { select: { sellKind: true } } },
          });
          for (const r of pim) {
            if (r.menuItem && r.menuItem.sellKind !== "set") includedSingleIds.add(r.menuItemId);
          }
        }
      }

      const itemInclude = {
        timeDiscounts: {
          include: { timeWindow: { select: { startMin: true, endMin: true } } },
        },
        optionLinks: {
          orderBy: { sortOrder: "asc" as const },
          include: {
            optionGroup: {
              include: {
                items: { orderBy: { sortOrder: "asc" as const } },
              },
            },
          },
        },
        setSteps: {
          orderBy: { sortOrder: "asc" as const },
          include: {
            choices: {
              orderBy: { sortOrder: "asc" as const },
              include: {
                componentMenuItem: {
                  select: {
                    id: true,
                    name: true,
                    isAvailable: true,
                    stockQty: true,
                    stockLowThreshold: true,
                    containsAlcohol: true,
                    allowTakeout: true,
                    category: {
                      include: { guestVisibleTimeWindow: true },
                    },
                    optionLinks: {
                      orderBy: { sortOrder: "asc" as const },
                      include: {
                        optionGroup: {
                          include: {
                            items: { orderBy: { sortOrder: "asc" as const } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      } as const;

      const rows = await prisma.menuItem.findMany({
        where: {
          id: { in: idList },
          category: { storeId: session.storeId },
        },
        include: itemInclude,
      });

      const itemsOut: Record<string, unknown>[] = [];
      for (const it of rows) {
        if (it.sellKind === "set") {
          const row = mapGuestSetMenuItemForReorder(it as never, st.menuPriceTaxMode, st.taxRatePercent, nowMin);
          if (!row) continue;
          itemsOut.push({ ...row, courseTier: "addon" as const });
        } else {
          const single = mapGuestMenuItem(it, st.menuPriceTaxMode, st.taxRatePercent, nowMin);
          const opt = mapGuestOptionGroups(it.optionLinks ?? []);
          if (opt.length) (single as Record<string, unknown>).optionGroups = opt;
          const courseTier =
            session.courseId == null
              ? null
              : includedSingleIds.has(it.id)
                ? ("included" as const)
                : ("addon" as const);
          itemsOut.push({ ...single, courseTier });
        }
      }
      return { items: itemsOut };
    },
  );

  /**
   * 同一卓の別会計（別ゲスト URL）を、この URL のセッションへ統合する（相手側を merged にする）。
   * Body: { peerGuestToken: string }
   */
  app.post<{ Params: { token: string }; Body: { peerGuestToken?: unknown } }>(
    "/guest/:token/combine-same-table-billing",
    async (req, reply) => {
      const raw =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as { peerGuestToken?: unknown }).peerGuestToken
          : undefined;
      const peerGuestToken = typeof raw === "string" ? raw.trim() : "";
      if (!peerGuestToken) {
        return reply.code(400).send({ error: "peerGuestToken が必要です" });
      }

      const caller = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
      });
      if (!caller || caller.status !== "open" || caller.mergedIntoSessionId) {
        return reply.code(404).send({ error: "session not found or closed" });
      }

      const peer = await prisma.diningSession.findUnique({
        where: { guestToken: peerGuestToken },
      });
      if (!peer || peer.storeId !== caller.storeId) {
        return reply.code(400).send({ error: "相手のセッションが見つかりません" });
      }
      if (peer.id === caller.id) {
        return reply.code(400).send({ error: "同じセッションです" });
      }
      if (peer.status !== "open" || peer.mergedIntoSessionId) {
        return reply.code(400).send({ error: "相手のセッションは統合できません" });
      }
      if (peer.tableId !== caller.tableId) {
        return reply.code(400).send({ error: "同じ卓のセッションだけ統合できます" });
      }

      const fromId = peer.id;
      const toId = caller.id;

      try {
        await prisma.$transaction(async (tx) => {
          await mergeTwoOpenSessionsTx(tx, caller.storeId, fromId, toId, "same_table_only");
        });
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        if (code === "MERGE_TARGET_IS_MERGED_CHILD") {
          return reply
            .code(400)
            .send({ error: "統合先として利用できないセッションです" });
        }
        if (code === "MERGE_STATUS") {
          return reply.code(400).send({ error: "利用中のセッション同士だけ統合できます" });
        }
        if (code === "MERGE_DIFFERENT_TABLE") {
          return reply.code(400).send({ error: "同じ卓のセッションだけ統合できます" });
        }
        if (code === "MERGE_COURSE_MISMATCH") {
          return reply
            .code(400)
            .send({ error: "コースと料金パターンがこのセッションと一致している必要があります" });
        }
        if (code === "MERGE_BILL_NOT_OPEN") {
          return reply.code(400).send({ error: "精算済みの伝票があるため統合できません" });
        }
        if (code === "MERGE_CHILD_COUNT") {
          return reply.code(400).send({ error: "統合後の人数が不整合になります" });
        }
        if (code === "MERGE_NOT_FOUND") {
          return reply.code(404).send({ error: "session not found" });
        }
        throw e;
      }

      return { ok: true };
    },
  );
}
