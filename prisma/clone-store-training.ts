/**
 * 本番店舗のマスタを練習用テナントへ複製する。
 *
 * コピーするもの: 設定・卓・メニュー・コース・オプション・調理場・時間帯・支払方法・ゲーム・受付設定
 * コピーしないもの: 来店セッション・伝票・入金・印刷ジョブ・顧客・ネット注文・予約・現金台帳
 *
 * 本番へ影響しないよう:
 *   - 別 storeId（既定 harunoyukoto-practice）
 *   - 卓 QR の publicCode は別コード
 *   - サーマル IP / SMTP / キッチン自動印刷を無効化
 *
 * 実行:
 *   npx tsx prisma/clone-store-training.ts
 *   npx tsx prisma/clone-store-training.ts --reset   # 練習店舗を消して作り直す
 *
 * 環境変数:
 *   SOURCE_STORE_ID  DEST_STORE_ID  TRAINING_EMAIL  TRAINING_PASSWORD
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mergeStoreSettings } from "../src/lib/store-settings.js";

function loadDotEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

const prisma = new PrismaClient();

const SOURCE_ID = (process.env.SOURCE_STORE_ID || "harunoyukoto").trim().toLowerCase();
const DEST_ID = (process.env.DEST_STORE_ID || "harunoyukoto-practice").trim().toLowerCase();
const TRAINING_EMAIL = (process.env.TRAINING_EMAIL || "renshu@practice.local").trim().toLowerCase();
const TRAINING_PASSWORD = process.env.TRAINING_PASSWORD || "renshu2026";
const RESET = process.argv.includes("--reset");

function remapPublicCode(oldPc: string, sourceId: string, destId: string): string {
  const pc = String(oldPc || "").trim();
  if (!pc) return `${destId}-table`;
  if (pc === `takeout-${sourceId}` || pc === `takeout-${sourceId.slice(0, 12)}`) {
    return `takeout-${destId}`;
  }
  const prefix = `${sourceId}-`;
  if (pc.toLowerCase().startsWith(prefix)) {
    return `${destId}-${pc.slice(prefix.length)}`;
  }
  return `${destId}-${pc}`;
}

function remapId(map: Map<string, string>, id: string | null | undefined): string | null {
  if (!id) return null;
  return map.get(id) ?? null;
}

function remapIdList(map: Map<string, string>, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of ids) {
    if (typeof x !== "string") continue;
    const n = map.get(x);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return (v ?? {}) as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  if (!/^[a-z0-9_-]{2,64}$/.test(DEST_ID) || DEST_ID === SOURCE_ID) {
    throw new Error(`不正な DEST_STORE_ID: ${DEST_ID}`);
  }
  if (TRAINING_PASSWORD.length < 8) {
    throw new Error("TRAINING_PASSWORD は 8 文字以上にしてください");
  }

  const source = await prisma.store.findUnique({ where: { id: SOURCE_ID } });
  if (!source) throw new Error(`元店舗がありません: ${SOURCE_ID}`);

  const existing = await prisma.store.findUnique({ where: { id: DEST_ID }, select: { id: true } });
  if (existing) {
    if (!RESET) {
      throw new Error(
        `練習店舗 ${DEST_ID} は既にあります。作り直す場合は --reset を付けて実行してください（練習側のデータだけ消えます。本番 ${SOURCE_ID} は触りません）。`,
      );
    }
    console.log(`練習店舗 ${DEST_ID} を削除して作り直します（本番 ${SOURCE_ID} は変更しません）`);
    await prisma.store.delete({ where: { id: DEST_ID } });
  }

  const passwordHash = bcrypt.hashSync(TRAINING_PASSWORD, 10);
  const destName = `【練習】${source.name}`;

  const srcSettings = mergeStoreSettings(source.settings);
  const settingsObj: Record<string, unknown> = {
    ...(typeof source.settings === "object" && source.settings && !Array.isArray(source.settings)
      ? (source.settings as Record<string, unknown>)
      : {}),
  };
  settingsObj.isTrainingStore = true;
  settingsObj.thermalReceiptPrinterIp = "";
  settingsObj.thermalKitchenPrinterIp = "";
  settingsObj.thermalKitchenAutoPrint = false;
  settingsObj.smtpOutboundEnabled = false;
  settingsObj.smtpHost = "";
  settingsObj.smtpUser = "";
  settingsObj.smtpPass = "";
  settingsObj.mailFrom = "";
  settingsObj.stockDailyResetLastRunDate = null;
  settingsObj.kitchenDrinkStationIds = [];
  settingsObj.takeoutPickupTimeWindowIds = [];

  console.log(`複製開始: ${SOURCE_ID} → ${DEST_ID}`);

  await prisma.store.create({
    data: { id: DEST_ID, name: destName, settings: asJson(settingsObj) },
  });

  const timeWindowMap = new Map<string, string>();
  const stationMap = new Map<string, string>();
  const tableMap = new Map<string, string>();
  const publicCodeMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const itemMap = new Map<string, string>();
  const optionGroupMap = new Map<string, string>();
  const courseMap = new Map<string, string>();
  const stepMap = new Map<string, string>();

  const [windows, stations, tables, methods, staff, categories, optionGroups, courses, receptionCfg, games] =
    await Promise.all([
      prisma.storeTimeWindow.findMany({ where: { storeId: SOURCE_ID }, orderBy: { sortOrder: "asc" } }),
      prisma.kitchenStation.findMany({ where: { storeId: SOURCE_ID }, orderBy: { sortOrder: "asc" } }),
      prisma.table.findMany({ where: { storeId: SOURCE_ID }, orderBy: { sortOrder: "asc" } }),
      prisma.storePaymentMethod.findMany({ where: { storeId: SOURCE_ID } }),
      prisma.staffUser.findMany({ where: { storeId: SOURCE_ID } }),
      prisma.menuCategory.findMany({ where: { storeId: SOURCE_ID }, orderBy: { sortOrder: "asc" } }),
      prisma.optionGroup.findMany({
        where: { storeId: SOURCE_ID },
        include: { items: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.course.findMany({
        where: { storeId: SOURCE_ID },
        include: {
          priceTiers: { orderBy: { sortOrder: "asc" } },
          includedItems: true,
          optionPacks: { include: { menuItems: true }, orderBy: { sortOrder: "asc" } },
        },
      }),
      prisma.receptionConfig.findUnique({ where: { storeId: SOURCE_ID } }),
      prisma.storeGame.findMany({ where: { storeId: SOURCE_ID }, orderBy: { sortOrder: "asc" } }),
    ]);

  for (const w of windows) {
    const row = await prisma.storeTimeWindow.create({
      data: {
        storeId: DEST_ID,
        name: w.name,
        startMin: w.startMin,
        endMin: w.endMin,
        sortOrder: w.sortOrder,
      },
    });
    timeWindowMap.set(w.id, row.id);
  }

  for (const s of stations) {
    const row = await prisma.kitchenStation.create({
      data: {
        storeId: DEST_ID,
        name: s.name,
        sortOrder: s.sortOrder,
        active: s.active,
        busyStoppedAt: null,
        busyStopAllItems: false,
      },
    });
    stationMap.set(s.id, row.id);
  }

  for (const t of tables) {
    const publicCode = remapPublicCode(t.publicCode, SOURCE_ID, DEST_ID);
    publicCodeMap.set(t.publicCode, publicCode);
    const row = await prisma.table.create({
      data: {
        storeId: DEST_ID,
        name: t.name,
        publicCode,
        sortOrder: t.sortOrder,
        capacity: t.capacity,
        mergeWith: [],
        seatType: t.seatType,
        active: t.active,
      },
    });
    tableMap.set(t.id, row.id);
  }
  for (const t of tables) {
    const newId = tableMap.get(t.id);
    if (!newId) continue;
    const raw = Array.isArray(t.mergeWith) ? t.mergeWith : [];
    const mergeWith = raw
      .filter((x): x is string => typeof x === "string")
      .map((pc) => publicCodeMap.get(pc) ?? remapPublicCode(pc, SOURCE_ID, DEST_ID));
    if (mergeWith.length) {
      await prisma.table.update({
        where: { id: newId },
        data: { mergeWith: mergeWith as Prisma.InputJsonValue },
      });
    }
  }

  for (const m of methods) {
    await prisma.storePaymentMethod.create({
      data: {
        storeId: DEST_ID,
        definitionId: m.definitionId,
        enabled: m.enabled,
        sortOrder: m.sortOrder,
        excludeFromSales: m.excludeFromSales,
      },
    });
  }

  const staffEmails = new Set<string>();
  await prisma.staffUser.create({
    data: {
      storeId: DEST_ID,
      email: TRAINING_EMAIL,
      passwordHash,
      name: "練習用",
      role: "manager",
    },
  });
  staffEmails.add(TRAINING_EMAIL);
  for (const u of staff) {
    const email = u.email.trim().toLowerCase();
    if (staffEmails.has(email)) continue;
    staffEmails.add(email);
    await prisma.staffUser.create({
      data: {
        storeId: DEST_ID,
        email,
        passwordHash,
        name: u.name,
        role: u.role,
      },
    });
  }

  let pendingCats = [...categories];
  while (pendingCats.length) {
    const ready = pendingCats.filter((c) => !c.parentId || categoryMap.has(c.parentId));
    if (!ready.length) {
      console.warn(`カテゴリの親が解決できない ${pendingCats.length} 件はルートとして複製します`);
      for (const c of pendingCats) {
        const row = await prisma.menuCategory.create({
          data: {
            storeId: DEST_ID,
            parentId: null,
            name: c.name,
            sortOrder: c.sortOrder,
            visibleToGuest: c.visibleToGuest,
            guestVisibleStartMin: c.guestVisibleStartMin,
            guestVisibleEndMin: c.guestVisibleEndMin,
            guestVisibleTimeWindowId: remapId(timeWindowMap, c.guestVisibleTimeWindowId),
          },
        });
        categoryMap.set(c.id, row.id);
      }
      break;
    }
    for (const c of ready) {
      const row = await prisma.menuCategory.create({
        data: {
          storeId: DEST_ID,
          parentId: remapId(categoryMap, c.parentId),
          name: c.name,
          sortOrder: c.sortOrder,
          visibleToGuest: c.visibleToGuest,
          guestVisibleStartMin: c.guestVisibleStartMin,
          guestVisibleEndMin: c.guestVisibleEndMin,
          guestVisibleTimeWindowId: remapId(timeWindowMap, c.guestVisibleTimeWindowId),
        },
      });
      categoryMap.set(c.id, row.id);
    }
    pendingCats = pendingCats.filter((c) => !categoryMap.has(c.id));
  }

  const items = await prisma.menuItem.findMany({
    where: { category: { storeId: SOURCE_ID } },
    include: {
      optionLinks: true,
      timeDiscounts: true,
      setSteps: { include: { choices: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { sortOrder: "asc" },
  });

  for (const it of items) {
    const categoryId = categoryMap.get(it.categoryId);
    if (!categoryId) continue;
    const row = await prisma.menuItem.create({
      data: {
        categoryId,
        name: it.name,
        description: it.description,
        imageUrl: it.imageUrl,
        recipe: it.recipe,
        price: it.price,
        priceTaxMode: it.priceTaxMode,
        sellKind: it.sellKind,
        sortOrder: it.sortOrder,
        isAvailable: it.isAvailable,
        stockQty: it.stockQty,
        stockLowThreshold: it.stockLowThreshold,
        stockDailyResetQty: it.stockDailyResetQty,
        kitchenStationId: remapId(stationMap, it.kitchenStationId),
        cookTimerSec: it.cookTimerSec,
        cookTimerSec2: it.cookTimerSec2,
        containsAlcohol: it.containsAlcohol,
        allowTakeout: it.allowTakeout,
        kitchenServeFast: it.kitchenServeFast,
        hallPrepCheck: it.hallPrepCheck,
        busyStopTarget: it.busyStopTarget,
        masterVersion: 1,
      },
    });
    itemMap.set(it.id, row.id);
  }

  for (const it of items) {
    const newItemId = itemMap.get(it.id);
    if (!newItemId) continue;
    for (const step of it.setSteps) {
      const row = await prisma.menuSetStep.create({
        data: {
          setMenuItemId: newItemId,
          label: step.label,
          minPick: step.minPick,
          maxPick: step.maxPick,
          sortOrder: step.sortOrder,
          allowServeLaterSplit: step.allowServeLaterSplit,
          serveLaterGroup: step.serveLaterGroup,
        },
      });
      stepMap.set(step.id, row.id);
      for (const ch of step.choices) {
        const componentMenuItemId = itemMap.get(ch.componentMenuItemId);
        if (!componentMenuItemId) continue;
        await prisma.menuSetChoice.create({
          data: {
            stepId: row.id,
            componentMenuItemId,
            extraPrice: ch.extraPrice,
            sortOrder: ch.sortOrder,
            isFixed: ch.isFixed,
          },
        });
      }
    }
    for (const td of it.timeDiscounts) {
      const timeWindowId = timeWindowMap.get(td.timeWindowId);
      if (!timeWindowId) continue;
      await prisma.menuItemTimeDiscount.create({
        data: {
          menuItemId: newItemId,
          timeWindowId,
          discountKind: td.discountKind,
          value: td.value,
        },
      });
    }
  }

  for (const g of optionGroups) {
    const row = await prisma.optionGroup.create({
      data: {
        storeId: DEST_ID,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        active: g.active,
      },
    });
    optionGroupMap.set(g.id, row.id);
    for (const oi of g.items) {
      await prisma.optionItem.create({
        data: {
          groupId: row.id,
          name: oi.name,
          priceDelta: oi.priceDelta,
          sortOrder: oi.sortOrder,
          active: oi.active,
        },
      });
    }
  }
  for (const it of items) {
    const newItemId = itemMap.get(it.id);
    if (!newItemId) continue;
    for (const link of it.optionLinks) {
      const optionGroupId = optionGroupMap.get(link.optionGroupId);
      if (!optionGroupId) continue;
      await prisma.menuItemOptionGroup.create({
        data: {
          menuItemId: newItemId,
          optionGroupId,
          sortOrder: link.sortOrder,
        },
      });
    }
  }

  for (const c of courses) {
    const row = await prisma.course.create({
      data: {
        storeId: DEST_ID,
        name: c.name,
        kind: c.kind,
        active: c.active,
        visibleToGuest: c.visibleToGuest,
        guestVisibleSlots: asJson(c.guestVisibleSlots),
        guestStartConfirmImageUrl: c.guestStartConfirmImageUrl,
        guestStartConfirmText: c.guestStartConfirmText,
        includedItemsUnlimited: c.includedItemsUnlimited,
      },
    });
    courseMap.set(c.id, row.id);
    for (const t of c.priceTiers) {
      await prisma.coursePriceTier.create({
        data: {
          courseId: row.id,
          durationMinutes: t.durationMinutes,
          pricePerPerson: t.pricePerPerson,
          childPricePerPerson: t.childPricePerPerson,
          sortOrder: t.sortOrder,
        },
      });
    }
    for (const inc of c.includedItems) {
      const menuItemId = itemMap.get(inc.menuItemId);
      if (!menuItemId) continue;
      await prisma.courseMenuItem.create({
        data: {
          courseId: row.id,
          menuItemId,
          minGuestCount: inc.minGuestCount,
        },
      });
    }
    for (const pack of c.optionPacks) {
      const p = await prisma.courseOptionPack.create({
        data: {
          courseId: row.id,
          name: pack.name,
          chargeScope: pack.chargeScope,
          extraPrice: pack.extraPrice,
          extraPriceTaxMode: pack.extraPriceTaxMode,
          sortOrder: pack.sortOrder,
        },
      });
      for (const mi of pack.menuItems) {
        const menuItemId = itemMap.get(mi.menuItemId);
        if (!menuItemId) continue;
        await prisma.courseOptionPackMenuItem.create({
          data: { packId: p.id, menuItemId },
        });
      }
    }
  }

  for (const g of games) {
    const rewardIds = remapIdList(itemMap, g.rewardMenuItemIds);
    await prisma.storeGame.create({
      data: {
        storeId: DEST_ID,
        sortOrder: g.sortOrder,
        enabled: g.enabled,
        kind: g.kind,
        slug: g.slug,
        title: g.title,
        description: g.description,
        iconEmoji: g.iconEmoji,
        playPriceYen: g.playPriceYen,
        rewardMenuItemId: remapId(itemMap, g.rewardMenuItemId),
        rewardMenuItemIds: rewardIds as Prisma.InputJsonValue,
        winMode: g.winMode,
        winProbabilityPercent: g.winProbabilityPercent,
        configJson: asJson(g.configJson),
      },
    });
  }

  if (receptionCfg) {
    await prisma.receptionConfig.create({
      data: { storeId: DEST_ID, data: asJson(receptionCfg.data) },
    });
  }
  await prisma.receptionState.create({
    data: { storeId: DEST_ID, callReserved: false, callType: "", entryQueue: [] },
  });

  settingsObj.kitchenDrinkStationIds = remapIdList(stationMap, srcSettings.kitchenDrinkStationIds);
  settingsObj.takeoutPickupTimeWindowIds = remapIdList(timeWindowMap, srcSettings.takeoutPickupTimeWindowIds);
  await prisma.store.update({
    where: { id: DEST_ID },
    data: { settings: asJson(settingsObj) },
  });

  console.log("複製完了");
  console.log(`  店舗名: ${destName}`);
  console.log(`  店舗ID: ${DEST_ID}`);
  console.log(`  ログイン: https://morder.harunoyukoto.jp/staff-app/login`);
  console.log(`  卓・会計: https://morder.harunoyukoto.jp/staff-app/${DEST_ID}/ops`);
  console.log(`  メール: ${TRAINING_EMAIL}`);
  console.log(`  パスワード: ${TRAINING_PASSWORD}`);
  console.log(`  卓 ${tableMap.size} / 商品 ${itemMap.size} / コース ${courseMap.size} / スタッフ ${staffEmails.size}`);
  console.log("本番店舗 harunoyukoto の注文・会計・印刷には接続していません。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
