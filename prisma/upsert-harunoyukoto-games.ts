import { prisma } from "../src/db.js";
import { seedStoreGameSamples } from "../src/lib/store-game-samples.js";

const STORE_ID = "harunoyukoto";

async function main() {
  const result = await seedStoreGameSamples(STORE_ID, { mode: "upsert" });
  console.log(
    `OK: ${STORE_ID} games — created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
