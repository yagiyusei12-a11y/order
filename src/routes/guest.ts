import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
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
  buildSetNameSnapshot,
  surchargeExclusiveStepSumInclusive,
  validateSetSelections,
  type GuestSetStepSelection,
  type SetStepForValidation,
} from "../lib/menu-set-order.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { prisma } from "../db.js";

function mapGuestMenuItem(
  it: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    priceTaxMode: string;
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
    price: discounted,
    priceTaxMode,
    basePrice: it.price,
    taxIncludedPrice: discounted,
    stockQty: it.stockQty,
    lowStock,
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
  enforceBlock: boolean,
): {
  deadlineIso: string;
  secondsRemaining: number;
  orderingClosed: boolean;
} | null {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const offset = Math.min(Math.max(0, offsetMinutesBeforeEnd), durationMinutes);
  const deadlineMs = openedAt.getTime() + (durationMinutes - offset) * 60 * 1000;
  const now = Date.now();
  const orderingClosed = enforceBlock && now > deadlineMs;
  const secondsRemaining = Math.floor((deadlineMs - now) / 1000);
  return {
    deadlineIso: new Date(deadlineMs).toISOString(),
    secondsRemaining,
    orderingClosed,
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
      choices: {
        componentMenuItemId: string;
        extraPrice: number;
        sortOrder: number;
        componentMenuItem: {
          id: string;
          name: string;
          isAvailable: boolean;
          stockQty: number | null;
          stockLowThreshold: number | null;
          category: {
            visibleToGuest: boolean;
            guestVisibleTimeWindowId: string | null;
            guestVisibleStartMin: number | null;
            guestVisibleEndMin: number | null;
            guestVisibleTimeWindow: { startMin: number; endMin: number } | null;
          };
        };
      }[];
    }[];
  },
  defaultPriceTaxMode: "inclusive" | "exclusive",
  taxRatePercent: number,
  nowMin: number,
): Record<string, unknown> | null {
  const stepsOut: Record<string, unknown>[] = [];
  for (const st of it.setSteps) {
    const choices: {
      menuItemId: string;
      name: string;
      extraPrice: number;
      extraTaxIncluded: number;
      stockQty: number | null;
      soldOut: boolean;
    }[] = [];
    for (const ch of st.choices) {
      const comp = ch.componentMenuItem;
      if (!comp.isAvailable) continue;
      if (!comp.category.visibleToGuest) continue;
      if (!componentVisibleToGuest(comp.category, nowMin)) continue;
      const ex = ch.extraPrice;
      const soldOut = comp.stockQty != null && comp.stockQty <= 0;
      choices.push({
        menuItemId: comp.id,
        name: comp.name,
        extraPrice: ex,
        extraTaxIncluded: Math.round(ex * (1 + taxRatePercent / 100)),
        stockQty: comp.stockQty,
        soldOut,
      });
    }
    const selectable = choices.filter((c) => !c.soldOut).length;
    if (st.minPick > 0 && selectable < st.minPick) {
      return null;
    }
    stepsOut.push({
      id: st.id,
      label: st.label,
      minPick: st.minPick,
      maxPick: st.maxPick,
      sortOrder: st.sortOrder,
      choices,
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
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: {
        course: {
          include: { includedItems: { select: { menuItemId: true } } },
        },
        coursePriceTier: true,
        customer: { select: { name: true, phone: true } },
      },
    });
    if (!session || session.status !== "open") {
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
              st.guestEnforceLastOrder,
            );
            if (!p) return null;
            return { ...p, minutesBeforeEnd: st.guestCourseLastOrderMinutesBeforeEnd };
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
                        category: {
                          include: { guestVisibleTimeWindow: true },
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

    return {
      session: {
        id: session.id,
        guestCount: session.guestCount,
        childCount: session.childCount,
        course: courseOut,
      },
      lastOrder,
      customerProfile: session.customer
        ? { name: session.customer.name, phone: session.customer.phone }
        : null,
      store: {
        showMenuPrices: st.guestShowMenuPrices,
        menuPriceTaxMode: st.menuPriceTaxMode,
        taxRatePercent: st.taxRatePercent,
        guestCourseIncludedChargeOptionExtras: st.guestCourseIncludedChargeOptionExtras,
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
              return { ...row, courseTier: "addon" as const };
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
            return { ...single, courseTier };
          })
          .filter(Boolean),
      })),
    };
  });

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

    try {
      const result = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { guestToken: req.params.token },
        });
        if (!sess || sess.status !== "open") {
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

        if (sess.customerId != null && sess.customerId !== customer.id) {
          const e = new Error("DEVICE_CONFLICT");
          throw e;
        }

        if (sess.customerId == null) {
          await tx.diningSession.update({
            where: { id: sess.id },
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
        setSelections?: GuestSetStepSelection[];
        optionSelections?: GuestOptionGroupSelection[];
      }[];
      note?: string;
    };
  }>("/guest/:token/orders", async (req, reply) => {
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: { course: true, coursePriceTier: true },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }

    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: "lines[] required" });
    }

    const storeRow = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);
    const storeTaxRatePercent = st.taxRatePercent;

    if (session.courseId && session.course && session.coursePriceTier) {
      const lo = computeGuestLastOrderPayload(
        session.openedAt,
        session.coursePriceTier.durationMinutes,
        st.guestCourseLastOrderMinutesBeforeEnd,
        st.guestEnforceLastOrder,
      );
      if (lo?.orderingClosed) {
        return reply.code(403).send({ error: "ラストオーダーの時間を過ぎています" });
      }
    }

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { id: session.id },
          include: {
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
        };
        type ResolvedSet = {
          kind: "set";
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice: number;
          nameSnapshot: string;
          lineExtra: Record<string, unknown>;
        };
        const resolved: (ResolvedSingle | ResolvedSet)[] = [];

        for (const l of lines) {
          if (typeof l.qty !== "number" || l.qty < 1 || !Number.isInteger(l.qty)) {
            throw new Error("BAD_QTY");
          }
          const sel = Array.isArray(l.setSelections) ? l.setSelections : [];
          const hasSetPayload = sel.length > 0;

          if (hasSetPayload) {
            const setItem = await tx.menuItem.findFirst({
              where: {
                id: l.menuItemId,
                isAvailable: true,
                sellKind: "set",
                category: { storeId: session.storeId, visibleToGuest: true },
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
                          },
                        },
                      },
                    },
                  },
                },
              },
            });
            if (!setItem) throw new Error("BAD_ITEM");
            const sc = setItem.category;
            const gw0 = sc.guestVisibleTimeWindow;
            const sl0 = gw0 ? { startMin: gw0.startMin, endMin: gw0.endMin } : null;
            if (!categoryGuestVisibleAt(sc, sl0, nowMin)) throw new Error("BAD_ITEM_TIME");

            const stepsVal: SetStepForValidation[] = setItem.setSteps.map((st) => ({
              id: st.id,
              label: st.label,
              minPick: st.minPick,
              maxPick: st.maxPick,
              choices: st.choices.map((c) => ({
                componentMenuItemId: c.componentMenuItemId,
                extraPrice: c.extraPrice,
              })),
            }));

            const validated = validateSetSelections(stepsVal, sel);
            if (!validated.ok) throw new Error("BAD_SET");
            const { byStep } = validated;

            for (const st of setItem.setSteps) {
              const picked = byStep.get(st.id) ?? [];
              for (const compId of picked) {
                const ch = st.choices.find((c) => c.componentMenuItemId === compId);
                if (!ch) throw new Error("BAD_SET");
                const comp = ch.componentMenuItem;
                if (!comp.isAvailable) throw new Error("BAD_ITEM");
                if (!comp.category.visibleToGuest) throw new Error("BAD_ITEM");
                const gw = comp.category.guestVisibleTimeWindow;
                const slice = gw ? { startMin: gw.startMin, endMin: gw.endMin } : null;
                if (!categoryGuestVisibleAt(comp.category, slice, nowMin)) {
                  throw new Error("BAD_ITEM_TIME");
                }
              }
            }

            const priceTaxMode =
              setItem.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseTaxIncluded =
              (setItem.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode) === "exclusive"
                ? Math.round(setItem.price * (1 + st.taxRatePercent / 100))
                : setItem.price;
            let surcharge = 0;
            for (const st of setItem.setSteps) {
              const picked = byStep.get(st.id) ?? [];
              const def = stepsVal.find((x) => x.id === st.id)!;
              surcharge += surchargeExclusiveStepSumInclusive(def, picked, storeTaxRatePercent);
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
            const lineExtra = buildSetLineExtra(
              setItem.setSteps.map((s) => ({ id: s.id, label: s.label })),
              byStep,
              nameById,
              stepsVal,
              storeTaxRatePercent,
            );
            const nameSnapshot = buildSetNameSnapshot(setItem.name, lineExtra);

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
            });
          } else {
            const plainItem = await tx.menuItem.findFirst({
              where: {
                id: l.menuItemId,
                isAvailable: true,
                sellKind: "single",
                category: { storeId: session.storeId, visibleToGuest: true },
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
            const cat0 = plainItem.category;
            const gw0 = cat0.guestVisibleTimeWindow;
            const sl0 = gw0 ? { startMin: gw0.startMin, endMin: gw0.endMin } : null;
            if (!categoryGuestVisibleAt(cat0, sl0, nowMin)) throw new Error("BAD_ITEM_TIME");

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

            const baseTaxIncluded =
              (plainItem.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode) === "exclusive"
                ? Math.round(plainItem.price * (1 + st.taxRatePercent / 100))
                : plainItem.price;
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
            const optSum =
              inCourseIncluded && !chargeOptExtras
                ? 0
                : sumInclusiveOptionPriceDelta(linkedGroups, vOpt.byGroup);
            const unitPriceWithOpts = effectiveBase + optSum;
            const lineExtraOpts = buildSingleOptionsLineExtra(linkedGroups, vOpt.byGroup);
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
              category: { storeId: session.storeId, visibleToGuest: true },
            },
            include: {
              category: { include: { guestVisibleTimeWindow: true } },
              timeDiscounts: {
                include: { timeWindow: { select: { startMin: true, endMin: true } } },
              },
            },
          });
          if (!item) throw new Error("BAD_ITEM");
          const cat = item.category;
          const gw = cat.guestVisibleTimeWindow;
          const slice = gw ? { startMin: gw.startMin, endMin: gw.endMin } : null;
          if (!categoryGuestVisibleAt(cat, slice, nowMin)) {
            throw new Error("BAD_ITEM_TIME");
          }
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
            sessionId: session.id,
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
            await tx.orderLine.create({
              data: {
                orderId: so.id,
                menuItemId: item.id,
                nameSnapshot,
                unitPrice,
                qty: r.qty,
                note: r.note,
                lineExtra: lineExtraJson,
                status: "queued",
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
                status: "queued",
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
      if (msg === "BAD_OPTIONS") {
        return reply.code(400).send({ error: "オプションの選択内容が正しくありません" });
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
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: { course: true, coursePriceTier: true },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    if (!session.courseId) {
      return reply.code(400).send({ error: "no course on this session" });
    }
    const pack = await prisma.courseOptionPack.findFirst({
      where: { id: packId.trim(), courseId: session.courseId },
    });
    if (!pack) {
      return reply.code(404).send({ error: "option pack not found" });
    }
    const storeRow0 = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { settings: true },
    });
    const st0 = mergeStoreSettings(storeRow0?.settings);
    if (session.courseId && session.course && session.coursePriceTier) {
      const lo = computeGuestLastOrderPayload(
        session.openedAt,
        session.coursePriceTier.durationMinutes,
        st0.guestCourseLastOrderMinutesBeforeEnd,
        st0.guestEnforceLastOrder,
      );
      if (lo?.orderingClosed) {
        return reply.code(403).send({ error: "ラストオーダーの時間を過ぎています" });
      }
    }
    const current = parsePurchasedCourseOptionPackIds(session.purchasedCourseOptionPackIds);
    if (current.includes(pack.id)) {
      return reply.code(409).send({ error: "すでに追加済みです" });
    }
    const scopePre = packChargeScopeFromDb(pack.chargeScope);
    const gcPre = Math.max(1, session.guestCount);
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

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({ where: { id: session.id } });
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
            sessionId: sess.id,
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
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const orders = await prisma.salesOrder.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      include: { lines: true },
    });
    return { orders };
  });
}
