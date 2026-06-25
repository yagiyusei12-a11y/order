import { prisma } from "../src/db.js";
import { seedSingleStoreGameSample } from "../src/lib/store-game-samples.js";

const STORE_ID = "harunoyukoto";
const SLUG = "anonymous-survey";

async function main() {
  const result = await seedSingleStoreGameSample(STORE_ID, SLUG);
  console.log(JSON.stringify({ storeId: STORE_ID, slug: SLUG, ...result }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
