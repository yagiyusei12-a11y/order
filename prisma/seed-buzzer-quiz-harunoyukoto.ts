import { prisma } from "../src/db.js";
import { seedSingleStoreGameSample } from "../src/lib/store-game-samples.js";

const STORE_ID = "harunoyukoto";
const SLUG = "buzzer-quiz";

async function main() {
  const result = await seedSingleStoreGameSample(STORE_ID, SLUG);
  console.log(`OK: ${STORE_ID} / ${SLUG} — ${result.status}`);
  for (const w of result.warnings) console.warn("warn:", w);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
