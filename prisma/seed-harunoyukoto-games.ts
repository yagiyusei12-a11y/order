import { prisma } from "../src/db.js";
import { seedStoreGameSamples } from "../src/lib/store-game-samples.js";

const STORE_ID = "harunoyukoto";

async function main() {
  const result = await seedStoreGameSamples(STORE_ID, { mode: "create-only" });
  console.log(
    `OK: ${STORE_ID} games — created ${result.created}, updated ${result.updated}, skipped ${result.skipped}`,
  );
  console.log("slugs:", result.slugs.join(", "));
  for (const w of result.warnings) console.warn("warn:", w);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
