import type { Prisma } from "@prisma/client";
import { parsePurchasedCourseOptionPackIds } from "./course-option-pack.js";

type Db = {
  courseMenuItem: {
    findMany: (args: {
      where: { courseId: string };
      include: { menuItem: { select: { sellKind: true } } };
    }) => Promise<{ menuItemId: string; minGuestCount: number; menuItem: { sellKind: string } | null }[]>;
  };
  courseOptionPackMenuItem: {
    findMany: (args: {
      where: { packId: { in: string[] }; pack: { courseId: string } };
      include: { menuItem: { select: { sellKind: true } } };
    }) => Promise<{ menuItemId: string; menuItem: { sellKind: string } | null }[]>;
  };
};

/** コース料に含まれる単品メニューID（人数・購入済みオプションパック込み） */
export async function courseIncludedSingleMenuItemIds(
  db: Db,
  params: {
    courseId: string;
    guestCount: number;
    purchasedCourseOptionPackIds?: unknown;
  },
): Promise<Set<string>> {
  const out = new Set<string>();
  const gc = Math.max(0, Number(params.guestCount) || 0);
  const links = await db.courseMenuItem.findMany({
    where: { courseId: params.courseId },
    include: { menuItem: { select: { sellKind: true } } },
  });
  for (const row of links) {
    if (row.menuItem && row.menuItem.sellKind !== "set" && gc >= row.minGuestCount) {
      out.add(row.menuItemId);
    }
  }
  const pids = parsePurchasedCourseOptionPackIds(params.purchasedCourseOptionPackIds);
  if (pids.length > 0) {
    const extras = await db.courseOptionPackMenuItem.findMany({
      where: { packId: { in: pids }, pack: { courseId: params.courseId } },
      include: { menuItem: { select: { sellKind: true } } },
    });
    for (const ex of extras) {
      if (ex.menuItem && ex.menuItem.sellKind !== "set") out.add(ex.menuItemId);
    }
  }
  return out;
}
