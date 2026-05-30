/**
 * harunoyukoto の店舗表示名を「はるのゆこと」に揃える（テイクアウトメール等）。
 *   npx tsx scripts/fix-harunoyukoto-store-display-name.ts
 */
import { prisma } from "../src/db.js";

const STORE_ID = "harunoyukoto";
const DISPLAY_NAME = "はるのゆこと";

async function main() {
  const row = await prisma.store.findUnique({ where: { id: STORE_ID } });
  if (!row) {
    console.log(`store ${STORE_ID} not found`);
    return;
  }
  if (row.name === DISPLAY_NAME) {
    console.log(`store.name already "${DISPLAY_NAME}"`);
    return;
  }
  await prisma.store.update({
    where: { id: STORE_ID },
    data: { name: DISPLAY_NAME },
  });
  console.log(`updated store.name: "${row.name}" -> "${DISPLAY_NAME}"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
