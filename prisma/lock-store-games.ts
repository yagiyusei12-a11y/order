import { prisma } from "../src/db.js";
import { markGameConfigStaffTouched } from "../src/lib/store-game-staff-lock.js";

const storeId = process.argv[2]?.trim() || "harunoyukoto";

async function main() {
  const games = await prisma.storeGame.findMany({
    where: { storeId },
    select: { id: true, slug: true, configJson: true },
  });
  let locked = 0;
  for (const g of games) {
    await prisma.storeGame.update({
      where: { id: g.id },
      data: { configJson: markGameConfigStaffTouched(g.configJson) },
    });
    locked += 1;
  }
  console.log(`OK: locked ${locked} games for store ${storeId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
