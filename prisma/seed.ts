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
    create: {
      id: "seed-store-1",
      name: "サンプル居酒屋",
      settings: {
        guestShowMenuPrices: true,
        kitchenAutoRefreshSec: 10,
        guestAutoRefreshSec: 20,
      },
    },
    update: {
      name: "サンプル居酒屋",
      settings: {
        guestShowMenuPrices: true,
        kitchenAutoRefreshSec: 10,
        guestAutoRefreshSec: 20,
      },
    },
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
  await prisma.staffUser.upsert({
    where: { storeId_email: { storeId: store.id, email: "hall@seed.local" } },
    create: {
      storeId: store.id,
      email: "hall@seed.local",
      passwordHash,
      name: "ホール担当",
    },
    update: { passwordHash, name: "ホール担当" },
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
  await prisma.table.upsert({
    where: { publicCode: "seed-t3" },
    create: {
      storeId: store.id,
      name: "3卓",
      publicCode: "seed-t3",
      sortOrder: 3,
    },
    update: { name: "3卓", active: true, storeId: store.id, sortOrder: 3 },
  });
  await prisma.table.upsert({
    where: { publicCode: "seed-t4" },
    create: {
      storeId: store.id,
      name: "4卓（メンテ中）",
      publicCode: "seed-t4",
      sortOrder: 4,
      active: false,
    },
    update: { name: "4卓（メンテ中）", active: false, storeId: store.id, sortOrder: 4 },
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
  await prisma.kitchenStation.upsert({
    where: { id: "seed-kst-cold" },
    create: {
      id: "seed-kst-cold",
      storeId: store.id,
      name: "冷菜場",
      sortOrder: 30,
      active: false,
    },
    update: { name: "冷菜場", sortOrder: 30, active: false },
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
  const catFried = await prisma.menuCategory.upsert({
    where: { id: "seed-cat-fried" },
    create: {
      id: "seed-cat-fried",
      storeId: store.id,
      parentId: "seed-cat-food",
      name: "揚げ物",
      sortOrder: 21,
      visibleToGuest: true,
    },
    update: {
      parentId: "seed-cat-food",
      name: "揚げ物",
      sortOrder: 21,
      visibleToGuest: true,
    },
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
    where: { id: "seed-item-highball" },
    create: {
      id: "seed-item-highball",
      categoryId: catDrink.id,
      name: "ハイボール",
      description: "すっきり定番",
      imageUrl: "/uploads/menu-items/sample-highball.jpg",
      price: 430,
      sortOrder: 3,
      kitchenStationId: "seed-kst-drink",
      stockQty: 18,
      stockLowThreshold: 5,
    },
    update: {
      categoryId: catDrink.id,
      name: "ハイボール",
      description: "すっきり定番",
      imageUrl: "/uploads/menu-items/sample-highball.jpg",
      price: 430,
      sortOrder: 3,
      isAvailable: true,
      kitchenStationId: "seed-kst-drink",
      stockQty: 18,
      stockLowThreshold: 5,
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
    where: { id: "seed-item-karaage" },
    create: {
      id: "seed-item-karaage",
      categoryId: catFried.id,
      name: "若鶏の唐揚げ",
      description: "ジューシー唐揚げ 5個",
      imageUrl: "/uploads/menu-items/sample-karaage.jpg",
      price: 580,
      sortOrder: 1,
      kitchenStationId: "seed-kst-hot",
      stockQty: 6,
      stockLowThreshold: 5,
      cookTimerSec: 30,
    },
    update: {
      categoryId: catFried.id,
      name: "若鶏の唐揚げ",
      description: "ジューシー唐揚げ 5個",
      imageUrl: "/uploads/menu-items/sample-karaage.jpg",
      price: 580,
      sortOrder: 1,
      isAvailable: true,
      kitchenStationId: "seed-kst-hot",
      stockQty: 6,
      stockLowThreshold: 5,
      cookTimerSec: 30,
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
    where: { id: "seed-item-ice" },
    create: {
      id: "seed-item-ice",
      categoryId: catFood.id,
      name: "バニラアイス",
      description: "締めのデザート",
      price: 280,
      sortOrder: 30,
      kitchenStationId: "seed-kst-cold",
      isAvailable: false,
    },
    update: {
      categoryId: catFood.id,
      name: "バニラアイス",
      description: "締めのデザート",
      price: 280,
      sortOrder: 30,
      kitchenStationId: "seed-kst-cold",
      isAvailable: false,
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
  await prisma.course.upsert({
    where: { id: "seed-course-nomihodai" },
    create: {
      id: "seed-course-nomihodai",
      storeId: store.id,
      name: "飲み放題90分",
      kind: "drink_all",
      durationMinutes: 90,
      pricePerPerson: 1800,
      active: true,
    },
    update: {
      name: "飲み放題90分",
      kind: "drink_all",
      durationMinutes: 90,
      pricePerPerson: 1800,
      active: true,
    },
  });
  await prisma.course.upsert({
    where: { id: "seed-course-lunch" },
    create: {
      id: "seed-course-lunch",
      storeId: store.id,
      name: "平日ランチ（停止中）",
      kind: "set_menu",
      durationMinutes: 60,
      pricePerPerson: 1200,
      active: false,
    },
    update: {
      name: "平日ランチ（停止中）",
      kind: "set_menu",
      durationMinutes: 60,
      pricePerPerson: 1200,
      active: false,
    },
  });
  await prisma.courseMenuItem.deleteMany({ where: { courseId: "seed-course-nomihodai" } });
  await prisma.courseMenuItem.createMany({
    data: [
      { courseId: "seed-course-nomihodai", menuItemId: "seed-item-beer" },
      { courseId: "seed-course-nomihodai", menuItemId: "seed-item-sour" },
      { courseId: "seed-course-nomihodai", menuItemId: "seed-item-highball" },
    ],
  });

  await prisma.optionGroup.upsert({
    where: { id: "seed-opt-size" },
    create: {
      id: "seed-opt-size",
      storeId: store.id,
      name: "サイズ",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 10,
      active: true,
    },
    update: {
      name: "サイズ",
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 10,
      active: true,
    },
  });
  await prisma.optionGroup.upsert({
    where: { id: "seed-opt-topping" },
    create: {
      id: "seed-opt-topping",
      storeId: store.id,
      name: "追加トッピング",
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 20,
      active: true,
    },
    update: {
      name: "追加トッピング",
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 20,
      active: true,
    },
  });
  await prisma.optionItem.upsert({
    where: { id: "seed-opt-size-normal" },
    create: { id: "seed-opt-size-normal", groupId: "seed-opt-size", name: "通常", priceDelta: 0, sortOrder: 10 },
    update: { groupId: "seed-opt-size", name: "通常", priceDelta: 0, sortOrder: 10, active: true },
  });
  await prisma.optionItem.upsert({
    where: { id: "seed-opt-size-large" },
    create: { id: "seed-opt-size-large", groupId: "seed-opt-size", name: "メガ", priceDelta: 200, sortOrder: 20 },
    update: { groupId: "seed-opt-size", name: "メガ", priceDelta: 200, sortOrder: 20, active: true },
  });
  await prisma.optionItem.upsert({
    where: { id: "seed-opt-top-cheese" },
    create: {
      id: "seed-opt-top-cheese",
      groupId: "seed-opt-topping",
      name: "チーズ",
      priceDelta: 80,
      sortOrder: 10,
    },
    update: { groupId: "seed-opt-topping", name: "チーズ", priceDelta: 80, sortOrder: 10, active: true },
  });
  await prisma.optionItem.upsert({
    where: { id: "seed-opt-top-spicy" },
    create: {
      id: "seed-opt-top-spicy",
      groupId: "seed-opt-topping",
      name: "辛味増し",
      priceDelta: 50,
      sortOrder: 20,
    },
    update: { groupId: "seed-opt-topping", name: "辛味増し", priceDelta: 50, sortOrder: 20, active: true },
  });
  await prisma.menuItemOptionGroup.deleteMany({
    where: { menuItemId: { in: ["seed-item-highball", "seed-item-karaage"] } },
  });
  await prisma.menuItemOptionGroup.createMany({
    data: [
      { menuItemId: "seed-item-highball", optionGroupId: "seed-opt-size", sortOrder: 0 },
      { menuItemId: "seed-item-karaage", optionGroupId: "seed-opt-topping", sortOrder: 0 },
    ],
  });

  await prisma.diningSession.upsert({
    where: { id: "seed-session-open-course" },
    create: {
      id: "seed-session-open-course",
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t1" } })).id,
      guestToken: "seed-guest-open-course",
      courseId: "seed-course-tabenomiho",
      guestCount: 3,
      status: "open",
    },
    update: {
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t1" } })).id,
      guestToken: "seed-guest-open-course",
      courseId: "seed-course-tabenomiho",
      guestCount: 3,
      status: "open",
      closedAt: null,
    },
  });
  await prisma.diningSession.upsert({
    where: { id: "seed-session-open-free" },
    create: {
      id: "seed-session-open-free",
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t2" } })).id,
      guestToken: "seed-guest-open-free",
      guestCount: 2,
      status: "open",
    },
    update: {
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t2" } })).id,
      guestToken: "seed-guest-open-free",
      courseId: null,
      guestCount: 2,
      status: "open",
      closedAt: null,
    },
  });
  await prisma.diningSession.upsert({
    where: { id: "seed-session-closed" },
    create: {
      id: "seed-session-closed",
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t3" } })).id,
      guestToken: "seed-guest-closed",
      courseId: "seed-course-nomihodai",
      guestCount: 4,
      status: "closed",
      closedAt: new Date(),
    },
    update: {
      storeId: store.id,
      tableId: (await prisma.table.findUniqueOrThrow({ where: { publicCode: "seed-t3" } })).id,
      guestToken: "seed-guest-closed",
      courseId: "seed-course-nomihodai",
      guestCount: 4,
      status: "closed",
      closedAt: new Date(),
    },
  });

  const seedOrders = [
    { id: "seed-order-open-1", sessionId: "seed-session-open-course", status: "cooking", note: "最初の注文" },
    { id: "seed-order-open-2", sessionId: "seed-session-open-course", status: "submitted", note: "追加注文" },
    { id: "seed-order-open-3", sessionId: "seed-session-open-course", status: "submitted", note: "団体追加1" },
    { id: "seed-order-open-4", sessionId: "seed-session-open-course", status: "cooking", note: "団体追加2" },
    { id: "seed-order-open-5", sessionId: "seed-session-open-course", status: "submitted", note: "団体追加3" },
    { id: "seed-order-open-6", sessionId: "seed-session-open-course", status: "submitted", note: "ラストオーダー前" },
    { id: "seed-order-karaage-demo", sessionId: "seed-session-open-course", status: "cooking", note: "唐揚げサンプル" },
    { id: "seed-order-free-1", sessionId: "seed-session-open-free", status: "cooking", note: "2卓の注文" },
    { id: "seed-order-free-2", sessionId: "seed-session-open-free", status: "submitted", note: "2卓の追加" },
    { id: "seed-order-karaage-t2", sessionId: "seed-session-open-free", status: "cooking", note: "2卓・唐揚げサンプル" },
    { id: "seed-order-free-3", sessionId: "seed-session-open-free", status: "submitted", note: "2卓の深夜追加" },
    { id: "seed-order-closed-1", sessionId: "seed-session-closed", status: "served", note: "会計済み" },
    { id: "seed-order-closed-2", sessionId: "seed-session-closed", status: "served", note: "会計済み2" },
  ] as const;
  for (const o of seedOrders) {
    await prisma.salesOrder.upsert({
      where: { id: o.id },
      create: { id: o.id, sessionId: o.sessionId, status: o.status, note: o.note },
      update: { sessionId: o.sessionId, status: o.status, note: o.note },
    });
  }

  await prisma.orderLine.deleteMany({
    where: {
      orderId: { in: seedOrders.map((o) => o.id) },
    },
  });
  await prisma.orderLine.createMany({
    data: [
      { id: "seed-line-open-1", orderId: "seed-order-open-1", menuItemId: "seed-item-beer", nameSnapshot: "生ビール（中）", unitPrice: 500, qty: 3, status: "done" },
      { id: "seed-line-open-2", orderId: "seed-order-open-1", menuItemId: "seed-item-karaage", nameSnapshot: "若鶏の唐揚げ", unitPrice: 580, qty: 1, note: "マヨ別皿", status: "cooking" },
      { id: "seed-line-open-3", orderId: "seed-order-open-2", menuItemId: "seed-item-potato", nameSnapshot: "ポテトフライ", unitPrice: 450, qty: 2, status: "queued" },
      { id: "seed-line-open-4", orderId: "seed-order-open-2", menuItemId: "seed-item-highball", nameSnapshot: "ハイボール", unitPrice: 430, qty: 2, status: "queued" },
      { id: "seed-line-open-5", orderId: "seed-order-open-3", menuItemId: "seed-item-beer", nameSnapshot: "生ビール（中）", unitPrice: 500, qty: 5, status: "queued" },
      { id: "seed-line-open-6", orderId: "seed-order-open-3", menuItemId: "seed-item-edamame", nameSnapshot: "枝豆", unitPrice: 350, qty: 4, status: "cooking" },
      { id: "seed-line-open-7", orderId: "seed-order-open-3", menuItemId: "seed-item-karaage", nameSnapshot: "若鶏の唐揚げ", unitPrice: 580, qty: 3, status: "queued" },
      { id: "seed-line-open-8", orderId: "seed-order-open-4", menuItemId: "seed-item-sour", nameSnapshot: "レモンサワー", unitPrice: 400, qty: 6, status: "cooking" },
      { id: "seed-line-open-9", orderId: "seed-order-open-4", menuItemId: "seed-item-potato", nameSnapshot: "ポテトフライ", unitPrice: 450, qty: 3, status: "queued" },
      { id: "seed-line-open-10", orderId: "seed-order-open-4", menuItemId: "seed-item-edamame", nameSnapshot: "枝豆", unitPrice: 350, qty: 2, status: "done" },
      { id: "seed-line-open-11", orderId: "seed-order-open-5", menuItemId: "seed-item-highball", nameSnapshot: "ハイボール", unitPrice: 430, qty: 4, status: "queued" },
      { id: "seed-line-open-12", orderId: "seed-order-open-5", menuItemId: "seed-item-karaage", nameSnapshot: "若鶏の唐揚げ", unitPrice: 580, qty: 2, status: "cooking" },
      { id: "seed-line-open-13", orderId: "seed-order-open-5", menuItemId: "seed-item-beer", nameSnapshot: "生ビール（中）", unitPrice: 500, qty: 2, status: "queued" },
      { id: "seed-line-open-14", orderId: "seed-order-open-6", menuItemId: "seed-item-sour", nameSnapshot: "レモンサワー", unitPrice: 400, qty: 5, status: "queued" },
      { id: "seed-line-open-15", orderId: "seed-order-open-6", menuItemId: "seed-item-potato", nameSnapshot: "ポテトフライ", unitPrice: 450, qty: 4, status: "queued" },
      {
        id: "seed-line-karaage-1",
        orderId: "seed-order-karaage-demo",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 2,
        note: "マヨ多め（サンプル）",
        status: "queued",
      },
      {
        id: "seed-line-karaage-2",
        orderId: "seed-order-karaage-demo",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 1,
        status: "cooking",
      },
      {
        id: "seed-line-karaage-3",
        orderId: "seed-order-karaage-demo",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 1,
        status: "done",
      },
      {
        id: "seed-line-karaage-4",
        orderId: "seed-order-karaage-demo",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 3,
        note: "大盛り",
        status: "queued",
      },
      { id: "seed-line-free-1", orderId: "seed-order-free-1", menuItemId: "seed-item-edamame", nameSnapshot: "枝豆", unitPrice: 350, qty: 2, status: "done" },
      { id: "seed-line-free-2", orderId: "seed-order-free-1", menuItemId: "seed-item-potato", nameSnapshot: "ポテトフライ", unitPrice: 450, qty: 1, status: "cooking" },
      { id: "seed-line-free-3", orderId: "seed-order-free-2", menuItemId: "seed-item-highball", nameSnapshot: "ハイボール", unitPrice: 430, qty: 3, status: "queued" },
      { id: "seed-line-free-4", orderId: "seed-order-free-2", menuItemId: "seed-item-karaage", nameSnapshot: "若鶏の唐揚げ", unitPrice: 580, qty: 1, status: "queued" },
      {
        id: "seed-line-karaage-t2-1",
        orderId: "seed-order-karaage-t2",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 2,
        note: "2卓・唐揚げサンプル",
        status: "cooking",
      },
      {
        id: "seed-line-karaage-t2-2",
        orderId: "seed-order-karaage-t2",
        menuItemId: "seed-item-karaage",
        nameSnapshot: "若鶏の唐揚げ",
        unitPrice: 580,
        qty: 1,
        status: "done",
      },
      { id: "seed-line-free-5", orderId: "seed-order-free-3", menuItemId: "seed-item-beer", nameSnapshot: "生ビール（中）", unitPrice: 500, qty: 2, status: "queued" },
      { id: "seed-line-free-6", orderId: "seed-order-free-3", menuItemId: "seed-item-sour", nameSnapshot: "レモンサワー", unitPrice: 400, qty: 2, status: "queued" },
      { id: "seed-line-closed-1", orderId: "seed-order-closed-1", menuItemId: "seed-item-sour", nameSnapshot: "レモンサワー", unitPrice: 400, qty: 4, status: "done" },
      { id: "seed-line-closed-2", orderId: "seed-order-closed-1", menuItemId: "seed-item-beer", nameSnapshot: "生ビール（中）", unitPrice: 500, qty: 4, status: "done" },
      { id: "seed-line-closed-3", orderId: "seed-order-closed-2", menuItemId: "seed-item-edamame", nameSnapshot: "枝豆", unitPrice: 350, qty: 3, status: "done" },
      { id: "seed-line-closed-4", orderId: "seed-order-closed-2", menuItemId: "seed-item-potato", nameSnapshot: "ポテトフライ", unitPrice: 450, qty: 3, status: "done" },
    ],
  });

  await prisma.bill.upsert({
    where: { id: "seed-bill-open" },
    create: {
      id: "seed-bill-open",
      storeId: store.id,
      sessionId: "seed-session-open-course",
      label: "1卓 会計途中",
      totalAmount: 12000,
      status: "open",
    },
    update: {
      storeId: store.id,
      sessionId: "seed-session-open-course",
      label: "1卓 会計途中",
      totalAmount: 12000,
      status: "open",
      settledAt: null,
    },
  });
  await prisma.bill.upsert({
    where: { id: "seed-bill-settled" },
    create: {
      id: "seed-bill-settled",
      storeId: store.id,
      sessionId: "seed-session-closed",
      label: "3卓 会計完了",
      totalAmount: 8800,
      status: "settled",
      settledAt: new Date(),
    },
    update: {
      storeId: store.id,
      sessionId: "seed-session-closed",
      label: "3卓 会計完了",
      totalAmount: 8800,
      status: "settled",
      settledAt: new Date(),
    },
  });
  await prisma.bill.upsert({
    where: { id: "seed-bill-void" },
    create: {
      id: "seed-bill-void",
      storeId: store.id,
      label: "取消伝票サンプル",
      totalAmount: 2400,
      status: "void",
    },
    update: {
      storeId: store.id,
      sessionId: null,
      label: "取消伝票サンプル",
      totalAmount: 2400,
      status: "void",
      settledAt: null,
    },
  });

  await prisma.payment.deleteMany({
    where: { billId: { in: ["seed-bill-open", "seed-bill-settled", "seed-bill-void"] } },
  });
  await prisma.payment.createMany({
    data: [
      {
        id: "seed-payment-open-1",
        billId: "seed-bill-open",
        methodCode: "cash",
        amount: 3000,
        note: "一部入金",
      },
      {
        id: "seed-payment-settled-1",
        billId: "seed-bill-settled",
        methodCode: "credit_card",
        amount: 5000,
      },
      {
        id: "seed-payment-settled-2",
        billId: "seed-bill-settled",
        methodCode: "cash",
        amount: 3800,
      },
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
