import { prisma } from "../src/db.js";
import { seedStoreGameSamples } from "../src/lib/store-game-samples.js";

const STORE_ID = "harunoyukoto";

async function main() {
  const result = await seedStoreGameSamples(STORE_ID, { mode: "create-only" });
  console.log(
    `OK: ${STORE_ID} games — created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
  );
  console.log("(existing games are never overwritten; use restore-store-games-snapshot.ts to restore from snapshot)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
