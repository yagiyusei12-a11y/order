import { writeFileSync } from "node:fs";
import { prisma } from "../src/db.js";

const storeId = process.argv[2]?.trim() || "harunoyukoto";

async function main() {
  const games = await prisma.storeGame.findMany({
    where: { storeId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      slug: true,
      kind: true,
      title: true,
      description: true,
      iconEmoji: true,
      playPriceYen: true,
      winMode: true,
      winProbabilityPercent: true,
      configJson: true,
      sortOrder: true,
      enabled: true,
      rewardMenuItemId: true,
      rewardMenuItemIds: true,
    },
  });
  const out = JSON.stringify({ storeId, exportedAt: new Date().toISOString(), games }, null, 2);
  if (process.argv.includes("--stdout")) {
    console.log(out);
  } else {
    const path = `prisma/store-snapshots/${storeId}-games.json`;
    writeFileSync(path, out, "utf8");
    console.log(`Wrote ${games.length} games to ${path}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
