import { prisma } from "../src/db.js";

const storeId = process.argv[2]?.trim() || "harunoyukoto";

async function main() {
  const game = await prisma.storeGame.findUnique({
    where: { storeId_slug: { storeId, slug: "memory-match" } },
    select: { id: true, title: true, description: true, configJson: true },
  });
  if (!game) {
    console.error("memory-match not found");
    process.exit(1);
  }
  const cfg =
    game.configJson != null && typeof game.configJson === "object" && !Array.isArray(game.configJson)
      ? { ...(game.configJson as Record<string, unknown>) }
      : {};
  delete cfg.timeLimitMs;
  cfg.maxMisses = typeof cfg.maxMisses === "number" ? cfg.maxMisses : 3;
  await prisma.storeGame.update({
    where: { id: game.id },
    data: {
      title: "おつまみ絵合わせ（神経衰弱）",
      description: "裏向きのカードから同じおつまみを揃えよう。ミス3回で終了！",
      configJson: cfg,
    },
  });
  console.log(`OK: ${storeId} memory-match → maxMisses=${cfg.maxMisses}, pairCount=${cfg.pairCount ?? "default"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
