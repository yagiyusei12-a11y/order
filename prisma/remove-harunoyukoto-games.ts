import { prisma } from "../src/db.js";
import { rememberDeletedGameSlug } from "../src/lib/store-game-deleted-slugs.js";

const STORE_ID = "harunoyukoto";
const REMOVE_SLUGS = ["omikuji", "lucky-stop"];

async function main() {
  for (const slug of REMOVE_SLUGS) {
    const game = await prisma.storeGame.findUnique({
      where: { storeId_slug: { storeId: STORE_ID, slug } },
      select: { id: true },
    });
    if (game) {
      await prisma.gamePlay.deleteMany({ where: { storeGameId: game.id } });
      await prisma.storeGame.delete({ where: { id: game.id } });
      console.log("deleted:", slug);
    } else {
      console.log("already gone:", slug);
    }
    await rememberDeletedGameSlug(STORE_ID, slug);
    console.log("blocked from auto-seed:", slug);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
