import type { Prisma, PrismaClient } from "@prisma/client";
import { mergeStoreSettings, type StoreSettingsShape } from "./store-settings.js";
import {
  longestStayDurationTier,
  resolveStayDurationTier,
  type StayDurationTier,
} from "./course-stay-tier.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type EffectiveCoursePriceTier = {
  id?: string;
  durationMinutes: number;
  pricePerPerson: number;
  childPricePerPerson: number | null;
};

type SessionLikeForStay = {
  courseId: string | null;
  openedAt: Date;
  coursePriceTier: EffectiveCoursePriceTier | null;
  orders: { createdAt: Date }[];
  guestCount?: number;
  childCount?: number;
};

/**
 * 滞在課金モードなら経過時間＋猶予で料金帯を決め、coursePriceTier を差し替えたセッションを返す。
 * オフ時やコースなしはそのまま。
 */
export async function withEffectiveCoursePriceTier<S extends SessionLikeForStay>(
  db: Db,
  storeId: string,
  session: S,
  asOf: Date = new Date(),
  settings?: StoreSettingsShape,
): Promise<S> {
  if (!session.courseId) return session;
  const st =
    settings ??
    mergeStoreSettings(
      (
        await db.store.findUnique({
          where: { id: storeId },
          select: { settings: true },
        })
      )?.settings,
    );
  if (!st.coursePricingByStayDuration) return session;

  const rows = await db.coursePriceTier.findMany({
    where: { courseId: session.courseId },
    orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }],
    select: {
      id: true,
      durationMinutes: true,
      pricePerPerson: true,
      childPricePerPerson: true,
      sortOrder: true,
    },
  });
  const tiers: StayDurationTier[] = rows.map((t) => ({
    id: t.id,
    durationMinutes: t.durationMinutes,
    pricePerPerson: t.pricePerPerson,
    childPricePerPerson: t.childPricePerPerson,
    sortOrder: t.sortOrder,
  }));
  const resolved = resolveStayDurationTier({
    tiers,
    openedAt: session.openedAt,
    asOf,
    orderCreatedAts: (session.orders || []).map((o) => o.createdAt),
    graceMinutes: st.courseStayGraceMinutes,
  });
  if (!resolved.tier) return session;
  return {
    ...session,
    coursePriceTier: {
      id: resolved.tier.id,
      durationMinutes: resolved.tier.durationMinutes,
      pricePerPerson: resolved.tier.pricePerPerson,
      childPricePerPerson: resolved.tier.childPricePerPerson,
    },
  };
}

/** 滞在課金モードで開始時に紐づける最長帯 ID（ラストオーダー用） */
export async function pickStayModeStartTierId(
  db: Db,
  courseId: string,
): Promise<string | null> {
  const rows = await db.coursePriceTier.findMany({
    where: { courseId },
    select: {
      id: true,
      durationMinutes: true,
      pricePerPerson: true,
      childPricePerPerson: true,
      sortOrder: true,
    },
  });
  const longest = longestStayDurationTier(
    rows.map((t) => ({
      id: t.id,
      durationMinutes: t.durationMinutes,
      pricePerPerson: t.pricePerPerson,
      childPricePerPerson: t.childPricePerPerson,
      sortOrder: t.sortOrder,
    })),
  );
  return longest?.id ?? null;
}
