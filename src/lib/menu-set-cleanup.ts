import type { Prisma } from "@prisma/client";

/**
 * セット候補の単品削除などで choice が消えたあと、候補0件の step を削除し、
 * step が無くなったセット商品は sellKind を single に戻す。
 */
export async function pruneOrphanSetStructure(tx: Prisma.TransactionClient): Promise<void> {
  const emptySteps = await tx.menuSetStep.findMany({
    where: { choices: { none: {} } },
    select: { id: true },
  });
  if (emptySteps.length > 0) {
    await tx.menuSetStep.deleteMany({
      where: { id: { in: emptySteps.map((e) => e.id) } },
    });
  }
  const bareSets = await tx.menuItem.findMany({
    where: { sellKind: "set", setSteps: { none: {} } },
    select: { id: true },
  });
  if (bareSets.length > 0) {
    await tx.menuItem.updateMany({
      where: { id: { in: bareSets.map((b) => b.id) } },
      data: { sellKind: "single" },
    });
  }
}
