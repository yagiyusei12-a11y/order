/**
 * カテゴリ「【ハッピーアワー11時～13時】半額」とその配下（子カテゴリ・商品）を削除する。
 * 実行: npx tsx prisma/remove-happy-hour-category.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_CATEGORY_NAMES = ["【ハッピーアワー11時～13時】半額"] as const;

async function deleteCategorySubtree(categoryId: string): Promise<void> {
  const children = await prisma.menuCategory.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  for (const c of children) {
    await deleteCategorySubtree(c.id);
  }
  await prisma.menuCategory.delete({ where: { id: categoryId } });
}

async function main() {
  const found = await prisma.menuCategory.findMany({
    where: { name: { in: [...TARGET_CATEGORY_NAMES] } },
    select: { id: true, name: true, storeId: true },
  });

  if (found.length === 0) {
    console.log("該当カテゴリはありませんでした:", TARGET_CATEGORY_NAMES.join(", "));
    return;
  }

  for (const row of found) {
    console.log(`削除: ${row.name} (id=${row.id}, storeId=${row.storeId})`);
    await deleteCategorySubtree(row.id);
  }

  console.log(`完了: ${found.length} 件のカテゴリツリーを削除しました（紐づく商品はカスケードで削除済み）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
