import { prisma } from "../src/db.js";

const storeId = process.argv[2]?.trim() || "harunoyukoto";
const tolerance = parseFloat(process.argv[3] || "2");

async function main() {
  const game = await prisma.storeGame.findUnique({
    where: { storeId_slug: { storeId, slug: "surface-tension" } },
    select: { id: true, configJson: true },
  });
  if (!game) {
    console.error("surface-tension not found");
    process.exit(1);
  }
  const cfg =
    game.configJson != null && typeof game.configJson === "object" && !Array.isArray(game.configJson)
      ? { ...(game.configJson as Record<string, unknown>) }
      : {};
  cfg.tolerancePercent = tolerance;
  await prisma.storeGame.update({
    where: { id: game.id },
    data: { configJson: cfg },
  });
  console.log(`OK: ${storeId} surface-tension tolerancePercent=${tolerance}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
