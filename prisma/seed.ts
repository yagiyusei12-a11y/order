import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_METHODS: { code: string; labelJa: string; sortOrder: number }[] = [
  { code: "cash", labelJa: "現金", sortOrder: 10 },
  { code: "credit_card", labelJa: "クレジット", sortOrder: 20 },
  { code: "qr_paypay", labelJa: "PayPay", sortOrder: 30 },
  { code: "qr_linepay", labelJa: "LINE Pay", sortOrder: 40 },
  { code: "emoney_transit", labelJa: "交通系IC", sortOrder: 50 },
  { code: "voucher", labelJa: "金券・商品券", sortOrder: 60 },
  { code: "other", labelJa: "その他", sortOrder: 99 },
];

async function main() {
  for (const m of DEFAULT_METHODS) {
    await prisma.paymentMethodDefinition.upsert({
      where: { code: m.code },
      create: m,
      update: { labelJa: m.labelJa, sortOrder: m.sortOrder },
    });
  }

  const store = await prisma.store.upsert({
    where: { id: "seed-store-1" },
    create: { id: "seed-store-1", name: "サンプル居酒屋" },
    update: { name: "サンプル居酒屋" },
  });

  const seedPw = process.env.SEED_STAFF_PASSWORD || "changeme";
  const passwordHash = bcrypt.hashSync(seedPw, 10);
  await prisma.staffUser.upsert({
    where: { storeId_email: { storeId: store.id, email: "admin@seed.local" } },
    create: {
      storeId: store.id,
      email: "admin@seed.local",
      passwordHash,
      name: "デモ店長",
    },
    update: { passwordHash, name: "デモ店長" },
  });

  const defs = await prisma.paymentMethodDefinition.findMany();
  for (const d of defs) {
    await prisma.storePaymentMethod.upsert({
      where: {
        storeId_definitionId: { storeId: store.id, definitionId: d.id },
      },
      create: {
        storeId: store.id,
        definitionId: d.id,
        enabled: true,
        sortOrder: d.sortOrder,
      },
      update: { sortOrder: d.sortOrder },
    });
  }

  await prisma.course.upsert({
    where: { id: "seed-course-tabenomiho" },
    create: {
      id: "seed-course-tabenomiho",
      storeId: store.id,
      name: "食べ飲み放題",
      kind: "eat_drink_all",
      durationMinutes: 120,
      pricePerPerson: 3500,
      active: true,
    },
    update: {
      name: "食べ飲み放題",
      kind: "eat_drink_all",
      durationMinutes: 120,
      pricePerPerson: 3500,
      active: true,
    },
  });

  await prisma.table.upsert({
    where: { publicCode: "seed-t1" },
    create: {
      storeId: store.id,
      name: "1卓",
      publicCode: "seed-t1",
      sortOrder: 1,
    },
    update: { name: "1卓", active: true, storeId: store.id },
  });
  await prisma.table.upsert({
    where: { publicCode: "seed-t2" },
    create: {
      storeId: store.id,
      name: "2卓",
      publicCode: "seed-t2",
      sortOrder: 2,
    },
    update: { name: "2卓", active: true, storeId: store.id },
  });

  await prisma.kitchenStation.upsert({
    where: { id: "seed-kst-drink" },
    create: {
      id: "seed-kst-drink",
      storeId: store.id,
      name: "ドリンク場",
      sortOrder: 10,
      active: true,
    },
    update: { name: "ドリンク場", sortOrder: 10, active: true },
  });
  await prisma.kitchenStation.upsert({
    where: { id: "seed-kst-hot" },
    create: {
      id: "seed-kst-hot",
      storeId: store.id,
      name: "ホット厨房",
      sortOrder: 20,
      active: true,
    },
    update: { name: "ホット厨房", sortOrder: 20, active: true },
  });

  const catDrink = await prisma.menuCategory.upsert({
    where: { id: "seed-cat-drink" },
    create: {
      id: "seed-cat-drink",
      storeId: store.id,
      name: "ドリンク",
      sortOrder: 10,
      visibleToGuest: true,
    },
    update: { name: "ドリンク", sortOrder: 10, visibleToGuest: true },
  });
  const catFood = await prisma.menuCategory.upsert({
    where: { id: "seed-cat-food" },
    create: {
      id: "seed-cat-food",
      storeId: store.id,
      name: "単品料理",
      sortOrder: 20,
      visibleToGuest: true,
    },
    update: { name: "単品料理", sortOrder: 20, visibleToGuest: true },
  });
  const catBack = await prisma.menuCategory.upsert({
    where: { id: "seed-cat-back" },
    create: {
      id: "seed-cat-back",
      storeId: store.id,
      name: "厨房連絡（ゲスト非表示）",
      sortOrder: 90,
      visibleToGuest: false,
    },
    update: { name: "厨房連絡（ゲスト非表示）", sortOrder: 90, visibleToGuest: false },
  });

  await prisma.menuItem.upsert({
    where: { id: "seed-item-beer" },
    create: {
      id: "seed-item-beer",
      categoryId: catDrink.id,
      name: "生ビール（中）",
      price: 500,
      sortOrder: 1,
      kitchenStationId: "seed-kst-drink",
    },
    update: {
      name: "生ビール（中）",
      price: 500,
      isAvailable: true,
      kitchenStationId: "seed-kst-drink",
    },
  });
  await prisma.menuItem.upsert({
    where: { id: "seed-item-sour" },
    create: {
      id: "seed-item-sour",
      categoryId: catDrink.id,
      name: "レモンサワー",
      price: 400,
      sortOrder: 2,
      kitchenStationId: "seed-kst-drink",
    },
    update: {
      name: "レモンサワー",
      price: 400,
      isAvailable: true,
      kitchenStationId: "seed-kst-drink",
    },
  });
  await prisma.menuItem.upsert({
    where: { id: "seed-item-edamame" },
    create: {
      id: "seed-item-edamame",
      categoryId: catFood.id,
      name: "枝豆",
      price: 350,
      sortOrder: 1,
      kitchenStationId: "seed-kst-hot",
    },
    update: {
      name: "枝豆",
      price: 350,
      isAvailable: true,
      kitchenStationId: "seed-kst-hot",
    },
  });
  await prisma.menuItem.upsert({
    where: { id: "seed-item-potato" },
    create: {
      id: "seed-item-potato",
      categoryId: catFood.id,
      name: "ポテトフライ",
      price: 450,
      sortOrder: 2,
      kitchenStationId: "seed-kst-hot",
    },
    update: {
      name: "ポテトフライ",
      price: 450,
      isAvailable: true,
      kitchenStationId: "seed-kst-hot",
    },
  });
  await prisma.menuItem.upsert({
    where: { id: "seed-item-kitchen-only" },
    create: {
      id: "seed-item-kitchen-only",
      categoryId: catBack.id,
      name: "下処理メモ（厨房のみ）",
      price: 0,
      sortOrder: 1,
      kitchenStationId: "seed-kst-hot",
    },
    update: {
      name: "下処理メモ（厨房のみ）",
      price: 0,
      isAvailable: true,
      kitchenStationId: "seed-kst-hot",
    },
  });

  await prisma.courseMenuItem.deleteMany({ where: { courseId: "seed-course-tabenomiho" } });
  await prisma.courseMenuItem.createMany({
    data: [
      { courseId: "seed-course-tabenomiho", menuItemId: "seed-item-beer" },
      { courseId: "seed-course-tabenomiho", menuItemId: "seed-item-sour" },
      { courseId: "seed-course-tabenomiho", menuItemId: "seed-item-edamame" },
      { courseId: "seed-course-tabenomiho", menuItemId: "seed-item-potato" },
    ],
  });

  console.log("Seed OK:", store.name);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
