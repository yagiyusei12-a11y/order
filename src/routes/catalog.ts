import type { FastifyInstance, FastifyReply } from "fastify";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseGuestHourFieldsFromBody } from "../lib/guest-category-hours.js";
import { pruneOrphanSetStructure } from "../lib/menu-set-cleanup.js";
import { prisma } from "../db.js";

async function validateMenuItemIdsForStore(
  storeId: string,
  raw: unknown
): Promise<{ ok: false } | { ok: true; ids: string[] }> {
  if (!Array.isArray(raw)) return { ok: false };
  const uniq = [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (uniq.length === 0) return { ok: true, ids: [] };
  const found = await prisma.menuItem.findMany({
    where: { id: { in: uniq }, category: { storeId } },
    select: { id: true },
  });
  if (found.length !== uniq.length) return { ok: false };
  return { ok: true, ids: uniq };
}

async function validateCourseMenuItemIds(
  storeId: string,
  raw: unknown,
): Promise<{ ok: false; error: string } | { ok: true; ids: string[] }> {
  const base = await validateMenuItemIdsForStore(storeId, raw);
  if (!base.ok) return { ok: false, error: "invalid menuItemIds" };
  if (base.ids.length === 0) return { ok: true, ids: [] };
  const sets = await prisma.menuItem.findMany({
    where: { id: { in: base.ids }, sellKind: "set" },
    select: { id: true },
  });
  if (sets.length > 0) {
    return {
      ok: false,
      error: "コース対象にセット商品は含められません（通常商品のみ選択してください）",
    };
  }
  return base;
}

type CourseMenuLinkIn = { menuItemId: string; minGuestCount: number };

async function validateCourseMenuLinks(
  storeId: string,
  raw: unknown,
): Promise<{ ok: false; error: string } | { ok: true; links: CourseMenuLinkIn[] }> {
  if (!Array.isArray(raw)) return { ok: false, error: "includedMenuLinks must be an array" };
  const links: CourseMenuLinkIn[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `includedMenuLinks[${i}] must be an object` };
    }
    const o = row as Record<string, unknown>;
    const mid = o.menuItemId;
    if (typeof mid !== "string" || !mid.trim()) {
      return { ok: false, error: `includedMenuLinks[${i}].menuItemId invalid` };
    }
    if (seen.has(mid)) return { ok: false, error: "duplicate menuItemId in includedMenuLinks" };
    seen.add(mid);
    let mg = 1;
    if ("minGuestCount" in o && o.minGuestCount !== undefined) {
      const v = o.minGuestCount;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 99) {
        return { ok: false, error: `includedMenuLinks[${i}].minGuestCount must be integer 1-99` };
      }
      mg = v;
    }
    links.push({ menuItemId: mid, minGuestCount: mg });
  }
  if (links.length === 0) return { ok: true, links: [] };
  const ids = links.map((l) => l.menuItemId);
  const found = await prisma.menuItem.findMany({
    where: { id: { in: ids }, category: { storeId } },
    select: { id: true, sellKind: true },
  });
  if (found.length !== ids.length) return { ok: false, error: "invalid menuItemIds in includedMenuLinks" };
  const sets = found.filter((x) => x.sellKind === "set");
  if (sets.length > 0) {
    return {
      ok: false,
      error: "コース対象にセット商品は含められません（通常商品のみ選択してください）",
    };
  }
  return { ok: true, links };
}

type CourseOptionPackChargeScope = "table_once" | "per_person_pick" | "per_person_all";

type CourseOptionPackIn = {
  name: string;
  chargeScope: CourseOptionPackChargeScope;
  extraPrice: number;
  extraPriceTaxMode: "inclusive" | "exclusive";
  sortOrder: number;
  menuItemIds: string[];
};

function normalizePackChargeScope(raw: unknown): CourseOptionPackChargeScope {
  if (raw === "per_person_pick" || raw === "per_person_all") return raw;
  return "table_once";
}

async function validateCourseOptionPacks(
  storeId: string,
  raw: unknown,
): Promise<{ ok: false; error: string } | { ok: true; packs: CourseOptionPackIn[] }> {
  if (!Array.isArray(raw)) return { ok: false, error: "optionPacks must be an array" };
  const packs: CourseOptionPackIn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `optionPacks[${i}] must be an object` };
    }
    const o = row as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) return { ok: false, error: `optionPacks[${i}].name required` };
    const ep = o.extraPrice;
    if (typeof ep !== "number" || !Number.isInteger(ep) || ep < 0 || ep > 1_000_000) {
      return { ok: false, error: `optionPacks[${i}].extraPrice must be integer 0-1000000` };
    }
    const sortOrder =
      typeof o.sortOrder === "number" && Number.isInteger(o.sortOrder) ? o.sortOrder : i;
    const midRaw = o.menuItemIds;
    if (!Array.isArray(midRaw)) {
      return { ok: false, error: `optionPacks[${i}].menuItemIds must be an array` };
    }
    const vIds = await validateCourseMenuItemIds(storeId, midRaw);
    if (!vIds.ok) return { ok: false, error: `optionPacks[${i}]: ${vIds.error}` };
    let extraPriceTaxMode: "inclusive" | "exclusive" = "inclusive";
    if ("extraPriceTaxMode" in o && o.extraPriceTaxMode !== undefined) {
      const tm = o.extraPriceTaxMode;
      if (tm !== "inclusive" && tm !== "exclusive") {
        return {
          ok: false,
          error: `optionPacks[${i}].extraPriceTaxMode must be "inclusive" or "exclusive"`,
        };
      }
      extraPriceTaxMode = tm;
    }
    const chargeScope = normalizePackChargeScope(o.chargeScope);
    packs.push({ name, chargeScope, extraPrice: ep, extraPriceTaxMode, sortOrder, menuItemIds: vIds.ids });
  }
  return { ok: true, packs };
}

function readIfMasterVersion(body: Record<string, unknown>): number | undefined {
  if (!("ifMasterVersion" in body)) return undefined;
  const v = body.ifMasterVersion;
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v;
}

async function assertMenuItemMasterVersion(
  item: { id: string; masterVersion: number },
  ifMasterVersion: number | undefined,
  reply: FastifyReply,
): Promise<boolean> {
  if (ifMasterVersion === undefined) return true;
  if (ifMasterVersion !== item.masterVersion) {
    reply.code(409).send({
      error: "他端末でメニューが更新されました。一覧を再読込してから保存してください。",
      conflict: true,
      currentMasterVersion: item.masterVersion,
    });
    return false;
  }
  return true;
}

async function validateOptionGroupIdsForStore(
  storeId: string,
  raw: unknown
): Promise<{ ok: false } | { ok: true; ids: string[] }> {
  if (!Array.isArray(raw)) return { ok: false };
  const uniq = [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (uniq.length === 0) return { ok: true, ids: [] };
  const found = await prisma.optionGroup.findMany({
    where: { id: { in: uniq }, storeId },
    select: { id: true },
  });
  if (found.length !== uniq.length) return { ok: false };
  return { ok: true, ids: uniq };
}

async function assertKitchenStationForStore(
  storeId: string,
  kitchenStationId: string | null
): Promise<{ ok: true } | { ok: false }> {
  if (kitchenStationId === null) return { ok: true };
  const st = await prisma.kitchenStation.findFirst({
    where: { id: kitchenStationId, storeId },
  });
  if (!st) return { ok: false };
  return { ok: true };
}

type MenuItemPatchData = {
  name?: string;
  price?: number;
  priceTaxMode?: string;
  description?: string | null;
  imageUrl?: string | null;
  recipe?: string | null;
  sortOrder?: number;
  isAvailable?: boolean;
  allowTakeout?: boolean;
  categoryId?: string;
  kitchenStationId?: string | null;
  stockQty?: number | null;
  stockLowThreshold?: number | null;
  cookTimerSec?: number | null;
  cookTimerSec2?: number | null;
  sellKind?: string;
  containsAlcohol?: boolean;
};

type ValidatedTimeDiscountRow = {
  timeWindowId: string;
  discountKind: string;
  value: number;
};

/** 時間帯ディスカウント行の検証（単体 PUT と一括 PATCH 共通） */
async function validateMenuItemTimeDiscountRows(
  storeId: string,
  raw: unknown,
  arrayError: string,
): Promise<{ error: string } | { rows: ValidatedTimeDiscountRow[] }> {
  if (!Array.isArray(raw)) return { error: arrayError };
  const seenTw = new Set<string>();
  const rows: ValidatedTimeDiscountRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { error: "invalid time discount row" };
    }
    const r = row as Record<string, unknown>;
    if (typeof r.timeWindowId !== "string") {
      return { error: "each row needs timeWindowId" };
    }
    if (r.discountKind !== "percent" && r.discountKind !== "fixed_yen") {
      return { error: "discountKind must be percent or fixed_yen" };
    }
    if (typeof r.value !== "number" || !Number.isInteger(r.value)) {
      return { error: "value must be integer" };
    }
    if (r.discountKind === "percent" && (r.value < 0 || r.value > 100)) {
      return { error: "percent value must be 0-100" };
    }
    if (r.discountKind === "fixed_yen" && r.value < 0) {
      return { error: "fixed_yen value must be non-negative" };
    }
    const twid = r.timeWindowId.trim();
    if (seenTw.has(twid)) return { error: "duplicate timeWindowId" };
    seenTw.add(twid);
    const tw = await prisma.storeTimeWindow.findFirst({
      where: { id: twid, storeId },
    });
    if (!tw) return { error: "time window not found" };
    rows.push({
      timeWindowId: twid,
      discountKind: r.discountKind as string,
      value: r.value,
    });
  }
  return { rows };
}

/** 単体 PATCH と一括 PATCH で共通の入力検証（optionGroupIds は含めない） */
async function buildMenuItemPatchData(
  storeId: string,
  body: Record<string, unknown>
): Promise<{ error: string } | { data: MenuItemPatchData }> {
  const data: MenuItemPatchData = {};
  if (body.categoryId !== undefined) {
    const cid = body.categoryId;
    if (typeof cid !== "string") return { error: "categoryId must be string" };
    const cat = await prisma.menuCategory.findFirst({
      where: { id: cid, storeId },
    });
    if (!cat) return { error: "category not found" };
    data.categoryId = cat.id;
  }
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) return { error: "name cannot be empty" };
    data.name = n;
  }
  if (typeof body.price === "number") {
    if (!Number.isInteger(body.price) || body.price < 0) {
      return { error: "price must be non-negative integer" };
    }
    data.price = body.price;
  }
  if (body && "priceTaxMode" in body) {
    if (body.priceTaxMode !== "inclusive" && body.priceTaxMode !== "exclusive") {
      return { error: "priceTaxMode must be inclusive or exclusive" };
    }
    data.priceTaxMode = body.priceTaxMode as string;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.imageUrl !== undefined) {
    data.imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() || null : null;
  }
  if (body.recipe !== undefined) {
    data.recipe = typeof body.recipe === "string" ? body.recipe.trim() || null : null;
  }
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) {
    data.sortOrder = body.sortOrder;
  }
  if (typeof body.isAvailable === "boolean") {
    data.isAvailable = body.isAvailable;
  }
  if (body && "allowTakeout" in body) {
    if (typeof body.allowTakeout !== "boolean") return { error: "allowTakeout must be boolean" };
    data.allowTakeout = body.allowTakeout;
  }
  if (body.kitchenStationId !== undefined) {
    if (body.kitchenStationId === null) {
      data.kitchenStationId = null;
    } else if (typeof body.kitchenStationId === "string") {
      const sid = body.kitchenStationId.trim();
      if (!sid) {
        data.kitchenStationId = null;
      } else {
        const ok = await assertKitchenStationForStore(storeId, sid);
        if (!ok.ok) return { error: "kitchenStation not found" };
        data.kitchenStationId = sid;
      }
    }
  }
  if (body && "stockQty" in body) {
    const v = body.stockQty;
    if (v === null) data.stockQty = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0) data.stockQty = v;
    else return { error: "stockQty must be null or non-negative integer" };
  }
  if (body && "stockLowThreshold" in body) {
    const v = body.stockLowThreshold;
    if (v === null) data.stockLowThreshold = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0) data.stockLowThreshold = v;
    else return { error: "stockLowThreshold must be null or non-negative integer" };
  }
  if (body && "cookTimerSec" in body) {
    const v = body.cookTimerSec;
    if (v === null || v === undefined) data.cookTimerSec = null;
    else if (v === 0) data.cookTimerSec = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 86400) data.cookTimerSec = v;
    else return { error: "cookTimerSec must be null, 0, or 1-86400" };
  }
  if (body && "cookTimerSec2" in body) {
    const v = body.cookTimerSec2;
    if (v === null || v === undefined) data.cookTimerSec2 = null;
    else if (v === 0) data.cookTimerSec2 = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 86400) data.cookTimerSec2 = v;
    else return { error: "cookTimerSec2 must be null, 0, or 1-86400" };
  }
  if (body && "sellKind" in body) {
    const sk = body.sellKind;
    if (sk !== "single" && sk !== "set") return { error: "sellKind must be single or set" };
    data.sellKind = sk;
  }
  if (body && "containsAlcohol" in body) {
    if (typeof body.containsAlcohol !== "boolean") return { error: "containsAlcohol must be boolean" };
    data.containsAlcohol = body.containsAlcohol;
  }
  return { data };
}

type SetDefChoiceIn = { menuItemId: string; extraPrice: number; sortOrder: number; isFixed?: boolean };
type SetDefStepIn = {
  label: string;
  minPick: number;
  maxPick: number;
  sortOrder: number;
  allowServeLaterSplit?: boolean;
  serveLaterGroup?: string;
  choices: SetDefChoiceIn[];
};

function normalizeServeLaterGroup(raw: unknown): "none" | "drink" | "dessert" {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "drink" || s === "dessert") return s;
  return "none";
}

function parseSetDefinitionBody(raw: unknown): { ok: false; error: string } | { ok: true; steps: SetDefStepIn[] } {
  if (!raw || typeof raw !== "object" || !("steps" in raw)) return { ok: false, error: "steps[] required" };
  const stepsRaw = (raw as { steps?: unknown }).steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return { ok: false, error: "steps must be a non-empty array" };
  }
  const steps: SetDefStepIn[] = [];
  for (let i = 0; i < stepsRaw.length; i++) {
    const row = stepsRaw[i];
    if (!row || typeof row !== "object") return { ok: false, error: "invalid step" };
    const label = typeof (row as { label?: unknown }).label === "string" ? (row as { label: string }).label.trim() : "";
    if (!label) return { ok: false, error: "step label required" };
    const minPick = (row as { minPick?: unknown }).minPick;
    const maxPick = (row as { maxPick?: unknown }).maxPick;
    const sortOrder = (row as { sortOrder?: unknown }).sortOrder;
    if (typeof minPick !== "number" || !Number.isInteger(minPick) || minPick < 0 || minPick > 50) {
      return { ok: false, error: "minPick must be 0-50 integer" };
    }
    if (typeof maxPick !== "number" || !Number.isInteger(maxPick) || maxPick < 0 || maxPick > 50) {
      return { ok: false, error: "maxPick must be 0-50 integer" };
    }
    if (maxPick < minPick) return { ok: false, error: "maxPick must be >= minPick" };
    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder)) {
      return { ok: false, error: "step sortOrder must be integer" };
    }
    const chRaw = (row as { choices?: unknown }).choices;
    if (!Array.isArray(chRaw) || chRaw.length === 0) {
      return { ok: false, error: "each step needs at least one choice" };
    }
      const choices: SetDefChoiceIn[] = [];
      const seenComp = new Set<string>();
      for (let j = 0; j < chRaw.length; j++) {
        const ch = chRaw[j];
        if (!ch || typeof ch !== "object") return { ok: false, error: "invalid choice" };
        const menuItemId =
          typeof (ch as { menuItemId?: unknown }).menuItemId === "string"
            ? (ch as { menuItemId: string }).menuItemId.trim()
            : "";
        if (!menuItemId) return { ok: false, error: "choice menuItemId required" };
        if (seenComp.has(menuItemId)) return { ok: false, error: "duplicate component in same step" };
        seenComp.add(menuItemId);
        const extraPrice = (ch as { extraPrice?: unknown }).extraPrice;
        if (typeof extraPrice !== "number" || !Number.isInteger(extraPrice) || extraPrice < 0 || extraPrice > 1_000_000) {
          return { ok: false, error: "extraPrice（税抜上乗せ円）は0-1000000の整数" };
        }
        const cSort = (ch as { sortOrder?: unknown }).sortOrder;
        if (typeof cSort !== "number" || !Number.isInteger(cSort)) {
          return { ok: false, error: "choice sortOrder must be integer" };
        }
        const isFixed = (ch as { isFixed?: unknown }).isFixed === true;
        choices.push({ menuItemId, extraPrice, sortOrder: cSort, isFixed });
      }
      choices.sort((a, b) => a.sortOrder - b.sortOrder);
      const pickable = choices.filter((c) => !c.isFixed);
      if (choices.length > 0 && pickable.length === 0 && (minPick !== 0 || maxPick !== 0)) {
        return {
          ok: false,
          error: "標準付属のみの項目は最小・最大を0にしてください: " + label,
        };
      }
      const allowServeLaterSplit = (row as { allowServeLaterSplit?: unknown }).allowServeLaterSplit === true;
      const serveLaterGroup = normalizeServeLaterGroup((row as { serveLaterGroup?: unknown }).serveLaterGroup);
      steps.push({ label, minPick, maxPick, sortOrder, allowServeLaterSplit, serveLaterGroup, choices });
  }
  steps.sort((a, b) => a.sortOrder - b.sortOrder);
  return { ok: true, steps };
}

type CourseTierRow = {
  id: string;
  durationMinutes: number;
  pricePerPerson: number;
  childPricePerPerson: number | null;
  sortOrder: number;
};

function mapCourseWithItems<
  T extends {
    includedItems: { menuItemId: string; minGuestCount?: number }[];
    priceTiers?: CourseTierRow[];
    optionPacks?: Array<{
      id: string;
      name: string;
      chargeScope?: string;
      extraPrice: number;
      extraPriceTaxMode?: string;
      sortOrder: number;
      menuItems: { menuItemId: string }[];
    }>;
  },
>(
  c: T,
): Omit<T, "includedItems" | "priceTiers" | "optionPacks"> & {
  includedMenuItemIds: string[];
  includedMenuLinks: { menuItemId: string; minGuestCount: number }[];
  priceTiers: CourseTierRow[];
  optionPacks: {
    id: string;
    name: string;
    chargeScope: CourseOptionPackChargeScope;
    extraPrice: number;
    extraPriceTaxMode: "inclusive" | "exclusive";
    sortOrder: number;
    menuItemIds: string[];
  }[];
} {
  const { includedItems, priceTiers, optionPacks, ...rest } = c;
  const links = includedItems.map((x) => ({
    menuItemId: x.menuItemId,
    minGuestCount: typeof x.minGuestCount === "number" ? x.minGuestCount : 1,
  }));
  const packs = optionPacks ?? [];
  return {
    ...rest,
    includedMenuItemIds: includedItems.map((x) => x.menuItemId),
    includedMenuLinks: links,
    priceTiers: (priceTiers || []).map((t) => ({
      id: t.id,
      durationMinutes: t.durationMinutes,
      pricePerPerson: t.pricePerPerson,
      childPricePerPerson: t.childPricePerPerson,
      sortOrder: t.sortOrder,
    })),
    optionPacks: packs.map((p) => ({
      id: p.id,
      name: p.name,
      chargeScope: normalizePackChargeScope(p.chargeScope),
      extraPrice: p.extraPrice,
      extraPriceTaxMode: p.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive",
      sortOrder: p.sortOrder,
      menuItemIds: p.menuItems.map((m) => m.menuItemId),
    })),
  };
}

type PriceTierInput = {
  durationMinutes: number;
  pricePerPerson: number;
  childPricePerPerson?: number | null;
  sortOrder?: number;
};

function normalizePriceTiersInput(
  raw: unknown,
): { ok: true; tiers: PriceTierInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "priceTiers must be a non-empty array" };
  }
  const tiers: PriceTierInput[] = [];
  const seenDm = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `priceTiers[${i}] must be an object` };
    }
    const o = row as Record<string, unknown>;
    const dm = o.durationMinutes;
    const pp = o.pricePerPerson;
    if (typeof dm !== "number" || !Number.isInteger(dm) || dm <= 0) {
      return { ok: false, error: `priceTiers[${i}].durationMinutes must be positive integer` };
    }
    if (typeof pp !== "number" || !Number.isInteger(pp) || pp < 0) {
      return { ok: false, error: `priceTiers[${i}].pricePerPerson must be non-negative integer` };
    }
    if (seenDm.has(dm)) return { ok: false, error: `duplicate durationMinutes ${dm}` };
    seenDm.add(dm);
    let childPricePerPerson: number | null | undefined;
    if ("childPricePerPerson" in o) {
      const cp = o.childPricePerPerson;
      if (cp === null) childPricePerPerson = null;
      else if (typeof cp === "number" && Number.isInteger(cp) && cp >= 0) childPricePerPerson = cp;
      else return { ok: false, error: `priceTiers[${i}].childPricePerPerson invalid` };
    }
    const sortOrder =
      typeof o.sortOrder === "number" && Number.isInteger(o.sortOrder) ? o.sortOrder : i;
    tiers.push({
      durationMinutes: dm,
      pricePerPerson: pp,
      ...(childPricePerPerson !== undefined ? { childPricePerPerson } : {}),
      sortOrder,
    });
  }
  tiers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.durationMinutes - b.durationMinutes);
  return { ok: true, tiers };
}

const MENU_IMAGE_UPLOAD_DIR = join(process.cwd(), "uploads", "menu-items");
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function safeImageExt(filename: string, mimetype: string): string {
  const byName = extname(filename || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(byName)) return byName === ".jpeg" ? ".jpg" : byName;
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/gif") return ".gif";
  return ".bin";
}

async function removeLocalUploadedImage(imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl || !imageUrl.startsWith("/uploads/menu-items/")) return;
  const oldName = imageUrl.slice("/uploads/menu-items/".length);
  const oldAbs = join(MENU_IMAGE_UPLOAD_DIR, oldName);
  await unlink(oldAbs).catch(() => undefined);
}

function copiedItemName(name: string): string {
  const base = name.trim() || "商品";
  if (base.endsWith("（コピー）")) return `${base} 2`;
  return `${base}（コピー）`;
}

function copiedCategoryName(name: string): string {
  const base = name.trim() || "カテゴリ";
  if (base.endsWith("（コピー）")) return `${base} 2`;
  return `${base}（コピー）`;
}

export async function registerCatalog(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/menu", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const categories = await prisma.menuCategory.findMany({
      where: { storeId: store.id, visibleToGuest: true },
      orderBy: { sortOrder: "asc" },
      include: {
        items: { where: { isAvailable: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    const categoriesOut = categories.map((c) => ({
      ...c,
      items: c.items.map(({ recipe: _r, ...it }) => it),
    }));
    return { storeId: store.id, categories: categoriesOut };
  });

  /** スタッフ用：販売停止含む全カテゴリ・全商品 */
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/menu/full", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const categories = await prisma.menuCategory.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: "asc" },
      include: {
        guestVisibleTimeWindow: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            kitchenStation: { select: { id: true, name: true, active: true } },
            optionLinks: {
              orderBy: { sortOrder: "asc" },
              select: { optionGroupId: true, sortOrder: true },
            },
            timeDiscounts: {
              include: { timeWindow: true },
            },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    componentMenuItem: {
                      select: {
                        id: true,
                        name: true,
                        sellKind: true,
                        isAvailable: true,
                        containsAlcohol: true,
                        price: true,
                        priceTaxMode: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    return { storeId: store.id, categories };
  });

  app.post<{
    Params: { storeId: string };
    Body: {
      name: string;
      sortOrder?: number;
      visibleToGuest?: boolean;
      parentId?: string | null;
      guestVisibleStartMin?: number | null;
      guestVisibleEndMin?: number | null;
      guestVisibleTimeWindowId?: string | null;
    };
  }>("/stores/:storeId/menu/categories", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const visibleToGuest = req.body?.visibleToGuest === false ? false : true;
    let parentId: string | null = null;
    if (req.body?.parentId !== undefined && req.body.parentId !== null) {
      const pid = String(req.body.parentId).trim();
      if (pid) {
        const parent = await prisma.menuCategory.findFirst({
          where: { id: pid, storeId: store.id },
          select: { id: true },
        });
        if (!parent) return reply.code(400).send({ error: "parent category not found" });
        parentId = parent.id;
      }
    }
    const hourParsed = parseGuestHourFieldsFromBody(req.body as Record<string, unknown>);
    if (!hourParsed.ok) return reply.code(400).send({ error: hourParsed.error });
    let guestVisibleStartMin: number | null = null;
    let guestVisibleEndMin: number | null = null;
    if (hourParsed.action === "set") {
      guestVisibleStartMin = hourParsed.guestVisibleStartMin;
      guestVisibleEndMin = hourParsed.guestVisibleEndMin;
    }
    let guestVisibleTimeWindowId: string | null = null;
    if (req.body && "guestVisibleTimeWindowId" in req.body) {
      const wid = req.body.guestVisibleTimeWindowId;
      if (wid === null || wid === "") {
        guestVisibleTimeWindowId = null;
      } else if (typeof wid === "string") {
        const w = await prisma.storeTimeWindow.findFirst({
          where: { id: wid.trim(), storeId: store.id },
        });
        if (!w) return reply.code(400).send({ error: "time window not found" });
        guestVisibleTimeWindowId = w.id;
        guestVisibleStartMin = null;
        guestVisibleEndMin = null;
      } else {
        return reply.code(400).send({ error: "guestVisibleTimeWindowId must be string or null" });
      }
    }
    const cat = await prisma.menuCategory.create({
      data: {
        storeId: store.id,
        name,
        sortOrder: req.body?.sortOrder ?? 0,
        visibleToGuest,
        parentId,
        guestVisibleStartMin,
        guestVisibleEndMin,
        guestVisibleTimeWindowId,
      },
    });
    return cat;
  });

  app.post<{
    Params: { storeId: string };
    Body: {
      categoryId: string;
      name: string;
      price: number;
      priceTaxMode?: string;
      description?: string;
      imageUrl?: string | null;
      recipe?: string | null;
      sortOrder?: number;
      kitchenStationId?: string | null;
      stockQty?: number | null;
      stockLowThreshold?: number | null;
      cookTimerSec?: number | null;
      cookTimerSec2?: number | null;
      containsAlcohol?: boolean;
      allowTakeout?: boolean;
    };
  }>("/stores/:storeId/menu/items", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.body?.categoryId, storeId: store.id },
    });
    if (!cat) return reply.code(400).send({ error: "category not found" });
    const name = req.body?.name?.trim();
    const price = req.body?.price;
    const priceTaxMode =
      req.body?.priceTaxMode === "exclusive" || req.body?.priceTaxMode === "inclusive"
        ? req.body.priceTaxMode
        : "inclusive";
    if (!name) return reply.code(400).send({ error: "name required" });
    if (typeof price !== "number" || !Number.isInteger(price) || price < 0) {
      return reply.code(400).send({ error: "price must be non-negative integer" });
    }
    let kitchenStationId: string | null = null;
    if (req.body?.kitchenStationId !== undefined && req.body.kitchenStationId !== null) {
      const sid = String(req.body.kitchenStationId).trim();
      if (sid) {
        const ok = await assertKitchenStationForStore(store.id, sid);
        if (!ok.ok) return reply.code(400).send({ error: "kitchenStation not found" });
        kitchenStationId = sid;
      }
    }
    let stockQty: number | null | undefined = undefined;
    if (req.body && "stockQty" in req.body) {
      const v = req.body.stockQty;
      if (v === null) stockQty = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 0) stockQty = v;
      else return reply.code(400).send({ error: "stockQty must be null or non-negative integer" });
    }
    let stockLowThreshold: number | null | undefined = undefined;
    if (req.body && "stockLowThreshold" in req.body) {
      const v = req.body.stockLowThreshold;
      if (v === null) stockLowThreshold = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 0) stockLowThreshold = v;
      else {
        return reply.code(400).send({ error: "stockLowThreshold must be null or non-negative integer" });
      }
    }
    let cookTimerSec: number | null | undefined = undefined;
    if (req.body && "cookTimerSec" in req.body) {
      const v = (req.body as { cookTimerSec?: unknown }).cookTimerSec;
      if (v === null || v === undefined) cookTimerSec = null;
      else if (v === 0 || v === "0") cookTimerSec = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 86400) cookTimerSec = v;
      else return reply.code(400).send({ error: "cookTimerSec must be null, 0, or 1-86400" });
    }
    let cookTimerSec2: number | null | undefined = undefined;
    if (req.body && "cookTimerSec2" in req.body) {
      const v = (req.body as { cookTimerSec2?: unknown }).cookTimerSec2;
      if (v === null || v === undefined) cookTimerSec2 = null;
      else if (v === 0 || v === "0") cookTimerSec2 = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 86400) cookTimerSec2 = v;
      else return reply.code(400).send({ error: "cookTimerSec2 must be null, 0, or 1-86400" });
    }
    let imageUrl: string | null | undefined = undefined;
    if (req.body && "imageUrl" in req.body) {
      if (req.body.imageUrl === null) imageUrl = null;
      else if (typeof req.body.imageUrl === "string") {
        const u = req.body.imageUrl.trim();
        imageUrl = u || null;
      } else return reply.code(400).send({ error: "imageUrl must be string or null" });
    }
    let containsAlcoholFlag = false;
    if (req.body && typeof req.body === "object" && "containsAlcohol" in req.body) {
      const ca = (req.body as { containsAlcohol?: unknown }).containsAlcohol;
      if (typeof ca !== "boolean") return reply.code(400).send({ error: "containsAlcohol must be boolean" });
      containsAlcoholFlag = ca;
    }
    let allowTakeoutFlag = false;
    if (req.body && typeof req.body === "object" && "allowTakeout" in req.body) {
      const at = (req.body as { allowTakeout?: unknown }).allowTakeout;
      if (typeof at !== "boolean") return reply.code(400).send({ error: "allowTakeout must be boolean" });
      allowTakeoutFlag = at;
    }
    let recipe: string | null | undefined = undefined;
    if (req.body && "recipe" in req.body) {
      if (req.body.recipe === null) recipe = null;
      else if (typeof req.body.recipe === "string") recipe = req.body.recipe.trim() || null;
      else return reply.code(400).send({ error: "recipe must be string or null" });
    }
    const item = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name,
        price,
        priceTaxMode,
        description: req.body?.description?.trim() || null,
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(recipe !== undefined ? { recipe } : {}),
        sortOrder: req.body?.sortOrder ?? 0,
        kitchenStationId,
        ...(stockQty !== undefined ? { stockQty } : {}),
        ...(stockLowThreshold !== undefined ? { stockLowThreshold } : {}),
        ...(cookTimerSec !== undefined ? { cookTimerSec } : {}),
        ...(cookTimerSec2 !== undefined ? { cookTimerSec2 } : {}),
        containsAlcohol: containsAlcoholFlag,
        allowTakeout: allowTakeoutFlag,
      },
    });
    return item;
  });

  app.patch<{
    Params: { storeId: string; categoryId: string };
    Body: {
      name?: string;
      sortOrder?: number;
      visibleToGuest?: boolean;
      parentId?: string | null;
      guestVisibleStartMin?: number | null;
      guestVisibleEndMin?: number | null;
      guestVisibleTimeWindowId?: string | null;
    };
  }>("/stores/:storeId/menu/categories/:categoryId", async (req, reply) => {
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
    });
    if (!cat) return reply.code(404).send({ error: "category not found" });
    const data: {
      name?: string;
      sortOrder?: number;
      visibleToGuest?: boolean;
      parentId?: string | null;
      guestVisibleStartMin?: number | null;
      guestVisibleEndMin?: number | null;
      guestVisibleTimeWindowId?: string | null;
    } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.visibleToGuest === "boolean") {
      data.visibleToGuest = req.body.visibleToGuest;
    }
    if (req.body && "parentId" in req.body) {
      if (req.body.parentId === null || req.body.parentId === "") {
        data.parentId = null;
      } else {
        const pid = String(req.body.parentId).trim();
        if (pid === cat.id) return reply.code(400).send({ error: "category cannot parent itself" });
        const parent = await prisma.menuCategory.findFirst({
          where: { id: pid, storeId: req.params.storeId },
          select: { id: true },
        });
        if (!parent) return reply.code(400).send({ error: "parent category not found" });
        data.parentId = parent.id;
      }
    }
    const hourParsed = parseGuestHourFieldsFromBody(req.body as Record<string, unknown>);
    if (!hourParsed.ok) return reply.code(400).send({ error: hourParsed.error });
    if (hourParsed.action === "clear") {
      data.guestVisibleStartMin = null;
      data.guestVisibleEndMin = null;
      data.guestVisibleTimeWindowId = null;
    } else if (hourParsed.action === "set") {
      data.guestVisibleStartMin = hourParsed.guestVisibleStartMin;
      data.guestVisibleEndMin = hourParsed.guestVisibleEndMin;
      data.guestVisibleTimeWindowId = null;
    }
    if (req.body && "guestVisibleTimeWindowId" in req.body) {
      const wid = req.body.guestVisibleTimeWindowId;
      if (wid === null || wid === "") {
        data.guestVisibleTimeWindowId = null;
      } else if (typeof wid === "string") {
        const w = await prisma.storeTimeWindow.findFirst({
          where: { id: wid.trim(), storeId: req.params.storeId },
        });
        if (!w) return reply.code(400).send({ error: "time window not found" });
        data.guestVisibleTimeWindowId = w.id;
        data.guestVisibleStartMin = null;
        data.guestVisibleEndMin = null;
      } else {
        return reply.code(400).send({ error: "guestVisibleTimeWindowId must be string or null" });
      }
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    const updated = await prisma.menuCategory.update({ where: { id: cat.id }, data });
    return updated;
  });

  /** カテゴリ内の商品表示順（ゲストメニューも同じ sortOrder で並ぶ） */
  app.put<{
    Params: { storeId: string; categoryId: string };
    Body: { itemIds: string[] };
  }>("/stores/:storeId/menu/categories/:categoryId/item-order", async (req, reply) => {
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
      include: { items: { select: { id: true } } },
    });
    if (!cat) return reply.code(404).send({ error: "category not found" });
    const ids = req.body?.itemIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: "itemIds[] required" });
    }
    const uniq = new Set(ids);
    if (uniq.size !== ids.length) return reply.code(400).send({ error: "duplicate itemIds" });
    const existing = new Set(cat.items.map((i) => i.id));
    if (existing.size !== ids.length || !ids.every((id) => existing.has(id))) {
      return reply.code(400).send({ error: "itemIds must list each item in this category exactly once" });
    }
    await prisma.$transaction(
      async (tx) => {
        for (let idx = 0; idx < ids.length; idx++) {
          await tx.menuItem.update({
            where: { id: ids[idx] },
            data: { sortOrder: idx },
          });
        }
      },
      { timeout: 60_000 }
    );
    return { ok: true };
  });

  app.post<{
    Params: { storeId: string; categoryId: string };
  }>("/stores/:storeId/menu/categories/:categoryId/copy", async (req, reply) => {
    const src = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            optionLinks: { orderBy: { sortOrder: "asc" } },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: { choices: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
      },
    });
    if (!src) return reply.code(404).send({ error: "category not found" });

    const copied = await prisma.$transaction(async (tx) => {
      const cat = await tx.menuCategory.create({
        data: {
          storeId: src.storeId,
          parentId: src.parentId,
          name: copiedCategoryName(src.name),
          sortOrder: (src.sortOrder ?? 0) + 1,
          visibleToGuest: src.visibleToGuest,
          guestVisibleStartMin: src.guestVisibleStartMin,
          guestVisibleEndMin: src.guestVisibleEndMin,
          guestVisibleTimeWindowId: src.guestVisibleTimeWindowId,
        },
      });

      for (const item of src.items) {
        const createdItem = await tx.menuItem.create({
          data: {
            categoryId: cat.id,
            name: copiedItemName(item.name),
            description: item.description,
            imageUrl: item.imageUrl,
            recipe: item.recipe,
            price: item.price,
            priceTaxMode: item.priceTaxMode,
            sellKind: item.sellKind === "set" ? "set" : "single",
            sortOrder: item.sortOrder,
            isAvailable: item.isAvailable,
            stockQty: item.stockQty,
            stockLowThreshold: item.stockLowThreshold,
            kitchenStationId: item.kitchenStationId,
            cookTimerSec: item.cookTimerSec,
            cookTimerSec2: item.cookTimerSec2,
          },
        });
        if (item.optionLinks.length > 0) {
          await tx.menuItemOptionGroup.createMany({
            data: item.optionLinks.map((l) => ({
              menuItemId: createdItem.id,
              optionGroupId: l.optionGroupId,
              sortOrder: l.sortOrder,
            })),
          });
        }
        if (item.sellKind === "set" && item.setSteps && item.setSteps.length > 0) {
          for (const st of item.setSteps) {
            const step = await tx.menuSetStep.create({
              data: {
                setMenuItemId: createdItem.id,
                label: st.label,
                minPick: st.minPick,
                maxPick: st.maxPick,
                sortOrder: st.sortOrder,
                allowServeLaterSplit: st.allowServeLaterSplit === true,
                serveLaterGroup: normalizeServeLaterGroup(st.serveLaterGroup),
              },
            });
            if (st.choices.length > 0) {
              await tx.menuSetChoice.createMany({
                data: st.choices.map((c) => ({
                  stepId: step.id,
                  componentMenuItemId: c.componentMenuItemId,
                  extraPrice: c.extraPrice,
                  sortOrder: c.sortOrder,
                  isFixed: c.isFixed === true,
                })),
              });
            }
          }
        }
      }
      return cat;
    });
    return copied;
  });

  app.delete<{
    Params: { storeId: string; categoryId: string };
  }>("/stores/:storeId/menu/categories/:categoryId", async (req, reply) => {
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
      select: { id: true, name: true },
    });
    if (!cat) return reply.code(404).send({ error: "category not found" });

    const childCount = await prisma.menuCategory.count({
      where: { parentId: cat.id, storeId: req.params.storeId },
    });
    if (childCount > 0) {
      return reply.code(400).send({ error: "category has child categories; delete/move children first" });
    }

    const images = await prisma.menuItem.findMany({
      where: { categoryId: cat.id },
      select: { imageUrl: true },
    });

    await prisma.menuCategory.delete({ where: { id: cat.id } });
    for (const r of images) {
      await removeLocalUploadedImage(r.imageUrl);
    }
    return { ok: true, deletedCategoryId: cat.id };
  });

  app.get<{ Params: { storeId: string } }>("/stores/:storeId/options/groups", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const groups = await prisma.optionGroup.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return { storeId: store.id, groups };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; minSelect?: number; maxSelect?: number; sortOrder?: number };
  }>("/stores/:storeId/options/groups", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const minSelect = req.body?.minSelect ?? 0;
    const maxSelect = req.body?.maxSelect ?? 1;
    if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect) || minSelect < 0 || maxSelect < minSelect) {
      return reply.code(400).send({ error: "invalid minSelect/maxSelect" });
    }
    const group = await prisma.optionGroup.create({
      data: {
        storeId: store.id,
        name,
        minSelect,
        maxSelect,
        sortOrder: req.body?.sortOrder ?? 0,
      },
    });
    return group;
  });

  app.patch<{
    Params: { storeId: string; groupId: string };
    Body: { name?: string; minSelect?: number; maxSelect?: number; sortOrder?: number; active?: boolean };
  }>("/stores/:storeId/options/groups/:groupId", async (req, reply) => {
    const group = await prisma.optionGroup.findFirst({
      where: { id: req.params.groupId, storeId: req.params.storeId },
    });
    if (!group) return reply.code(404).send({ error: "group not found" });
    const data: {
      name?: string;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
      active?: boolean;
    } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.minSelect === "number") {
      if (!Number.isInteger(req.body.minSelect) || req.body.minSelect < 0) {
        return reply.code(400).send({ error: "minSelect must be non-negative integer" });
      }
      data.minSelect = req.body.minSelect;
    }
    if (typeof req.body?.maxSelect === "number") {
      if (!Number.isInteger(req.body.maxSelect) || req.body.maxSelect < 0) {
        return reply.code(400).send({ error: "maxSelect must be non-negative integer" });
      }
      data.maxSelect = req.body.maxSelect;
    }
    if (
      (data.minSelect !== undefined || data.maxSelect !== undefined) &&
      (data.maxSelect ?? group.maxSelect) < (data.minSelect ?? group.minSelect)
    ) {
      return reply.code(400).send({ error: "maxSelect must be >= minSelect" });
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.active === "boolean") {
      data.active = req.body.active;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    return prisma.optionGroup.update({ where: { id: group.id }, data });
  });

  app.post<{
    Params: { storeId: string; groupId: string };
    Body: { name: string; priceDelta?: number; sortOrder?: number };
  }>("/stores/:storeId/options/groups/:groupId/items", async (req, reply) => {
    const group = await prisma.optionGroup.findFirst({
      where: { id: req.params.groupId, storeId: req.params.storeId },
    });
    if (!group) return reply.code(404).send({ error: "group not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const priceDelta = req.body?.priceDelta ?? 0;
    if (typeof priceDelta !== "number" || !Number.isInteger(priceDelta)) {
      return reply.code(400).send({ error: "priceDelta must be integer" });
    }
    return prisma.optionItem.create({
      data: {
        groupId: group.id,
        name,
        priceDelta,
        sortOrder: req.body?.sortOrder ?? 0,
      },
    });
  });

  app.patch<{
    Params: { storeId: string; groupId: string; optionItemId: string };
    Body: { name?: string; priceDelta?: number; sortOrder?: number; active?: boolean };
  }>("/stores/:storeId/options/groups/:groupId/items/:optionItemId", async (req, reply) => {
    const oi = await prisma.optionItem.findFirst({
      where: {
        id: req.params.optionItemId,
        group: { id: req.params.groupId, storeId: req.params.storeId },
      },
    });
    if (!oi) return reply.code(404).send({ error: "option item not found" });
    const data: { name?: string; priceDelta?: number; sortOrder?: number; active?: boolean } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.priceDelta === "number") {
      if (!Number.isInteger(req.body.priceDelta)) return reply.code(400).send({ error: "priceDelta must be integer" });
      data.priceDelta = req.body.priceDelta;
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.active === "boolean") {
      data.active = req.body.active;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    return prisma.optionItem.update({ where: { id: oi.id }, data });
  });

  app.put<{
    Params: { storeId: string; itemId: string };
    Body: { optionGroupIds?: unknown };
  }>("/stores/:storeId/menu/items/:itemId/options", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
      select: { id: true, masterVersion: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });
    const bodyObj = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const ifM = readIfMasterVersion(bodyObj);
    if (!(await assertMenuItemMasterVersion(item, ifM, reply))) return;
    const v = await validateOptionGroupIdsForStore(req.params.storeId, bodyObj.optionGroupIds);
    if (!v.ok) return reply.code(400).send({ error: "invalid optionGroupIds" });
    await prisma.$transaction(async (tx) => {
      await tx.menuItemOptionGroup.deleteMany({ where: { menuItemId: item.id } });
      if (v.ids.length > 0) {
        await tx.menuItemOptionGroup.createMany({
          data: v.ids.map((optionGroupId, idx) => ({
            menuItemId: item.id,
            optionGroupId,
            sortOrder: idx,
          })),
        });
      }
      await tx.menuItem.update({
        where: { id: item.id },
        data: { masterVersion: { increment: 1 } },
      });
    });
    const links = await prisma.menuItemOptionGroup.findMany({
      where: { menuItemId: item.id },
      orderBy: { sortOrder: "asc" },
    });
    return { menuItemId: item.id, links };
  });

  app.post<{
    Params: { storeId: string; itemId: string };
  }>("/stores/:storeId/menu/items/:itemId/image", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "image file required" });
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return reply.code(400).send({ error: "unsupported image type" });
    }

    const ext = safeImageExt(file.filename, file.mimetype);
    const filename = `${item.id}-${Date.now()}${ext}`;
    await mkdir(MENU_IMAGE_UPLOAD_DIR, { recursive: true });
    const absPath = join(MENU_IMAGE_UPLOAD_DIR, filename);
    const imageUrl = `/uploads/menu-items/${filename}`;
    const buf = await file.toBuffer();
    await writeFile(absPath, buf);

    const old = item.imageUrl;
    const updated = await prisma.menuItem.update({
      where: { id: item.id },
      data: { imageUrl, masterVersion: { increment: 1 } },
    });
    await removeLocalUploadedImage(old);
    return { ok: true, imageUrl: updated.imageUrl };
  });

  app.delete<{
    Params: { storeId: string; itemId: string };
  }>("/stores/:storeId/menu/items/:itemId/image", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });
    await prisma.menuItem.update({
      where: { id: item.id },
      data: { imageUrl: null, masterVersion: { increment: 1 } },
    });
    await removeLocalUploadedImage(item.imageUrl);
    return { ok: true };
  });

  app.patch<{
    Params: { storeId: string; itemId: string };
    Body: {
      name?: string;
      price?: number;
      priceTaxMode?: string;
      description?: string | null;
      imageUrl?: string | null;
      recipe?: string | null;
      sortOrder?: number;
      isAvailable?: boolean;
      categoryId?: string;
      kitchenStationId?: string | null;
      stockQty?: number | null;
      stockLowThreshold?: number | null;
      cookTimerSec?: number | null;
      cookTimerSec2?: number | null;
      sellKind?: "single" | "set";
      containsAlcohol?: boolean;
    };
  }>("/stores/:storeId/menu/items/:itemId", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
      include: { category: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });

    const bodyRaw = { ...(req.body as Record<string, unknown>) };
    const ifM = readIfMasterVersion(bodyRaw);
    delete bodyRaw.ifMasterVersion;
    if (!(await assertMenuItemMasterVersion(item, ifM, reply))) return;

    const built = await buildMenuItemPatchData(req.params.storeId, bodyRaw);
    if ("error" in built) return reply.code(400).send({ error: built.error });
    const data = built.data;
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    if (data.sellKind === "set") {
      const stepCount = await prisma.menuSetStep.count({ where: { setMenuItemId: item.id } });
      if (stepCount === 0) {
        return reply
          .code(400)
          .send({ error: "セット商品にするには、先に「セット構成」を保存して項目を1件以上登録してください" });
      }
    }

    const prevImageUrl = item.imageUrl;
    const clearingSet = data.sellKind === "single" && item.sellKind === "set";
    const updated = await prisma.$transaction(async (tx) => {
      if (clearingSet) {
        await tx.menuSetStep.deleteMany({ where: { setMenuItemId: item.id } });
      }
      return tx.menuItem.update({
        where: { id: item.id },
        data: { ...data, masterVersion: { increment: 1 } },
      });
    });
    if ("imageUrl" in data && data.imageUrl !== prevImageUrl) {
      await removeLocalUploadedImage(prevImageUrl);
    }
    return updated;
  });

  app.put<{
    Params: { storeId: string; itemId: string };
    Body: { steps?: unknown };
  }>("/stores/:storeId/menu/items/:itemId/set-definition", async (req, reply) => {
    const storeId = req.params.storeId;
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId } },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });

    const bodyObj = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const ifM = readIfMasterVersion(bodyObj);
    if (!(await assertMenuItemMasterVersion(item, ifM, reply))) return;

    const parsed = parseSetDefinitionBody(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const setItemId = item.id;
    const allCompIds = new Set<string>();
    for (const st of parsed.steps) {
      for (const c of st.choices) {
        if (c.menuItemId === setItemId) {
          return reply.code(400).send({ error: "set cannot include itself as a choice" });
        }
        allCompIds.add(c.menuItemId);
      }
    }

    const comps = await prisma.menuItem.findMany({
      where: { id: { in: [...allCompIds] }, category: { storeId } },
      select: { id: true, sellKind: true },
    });
    if (comps.length !== allCompIds.size) {
      return reply.code(400).send({ error: "invalid component menuItemId" });
    }
    for (const c of comps) {
      if (c.sellKind === "set") {
        return reply.code(400).send({ error: "set choices must be single items, not other sets" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.menuSetStep.deleteMany({ where: { setMenuItemId: setItemId } });
      for (const st of parsed.steps) {
        const step = await tx.menuSetStep.create({
          data: {
            setMenuItemId: setItemId,
            label: st.label,
            minPick: st.minPick,
            maxPick: st.maxPick,
            sortOrder: st.sortOrder,
            allowServeLaterSplit: st.allowServeLaterSplit === true,
            serveLaterGroup: normalizeServeLaterGroup(st.serveLaterGroup),
          },
        });
        await tx.menuSetChoice.createMany({
          data: st.choices.map((c) => ({
            stepId: step.id,
            componentMenuItemId: c.menuItemId,
            extraPrice: c.extraPrice,
            sortOrder: c.sortOrder,
            isFixed: c.isFixed === true,
          })),
        });
      }
      await tx.menuItem.update({
        where: { id: setItemId },
        data: { sellKind: "set", masterVersion: { increment: 1 } },
      });
    });

    const out = await prisma.menuItem.findUniqueOrThrow({
      where: { id: setItemId },
      include: {
        setSteps: {
          orderBy: { sortOrder: "asc" },
          include: {
            choices: {
              orderBy: { sortOrder: "asc" },
              include: {
                componentMenuItem: {
                  select: { id: true, name: true, sellKind: true, isAvailable: true, price: true, priceTaxMode: true },
                },
              },
            },
          },
        },
      },
    });
    return out;
  });

  app.patch<{
    Params: { storeId: string };
    Body: { itemIds?: unknown; patch?: Record<string, unknown> };
  }>("/stores/:storeId/menu/items/bulk", async (req, reply) => {
    const storeId = req.params.storeId;
    const itemIdsRaw = req.body?.itemIds;
    const patchRaw = req.body?.patch;
    const v = await validateMenuItemIdsForStore(storeId, itemIdsRaw);
    if (!v.ok) return reply.code(400).send({ error: "invalid itemIds" });
    if (v.ids.length === 0) return reply.code(400).send({ error: "itemIds required" });
    if (!patchRaw || typeof patchRaw !== "object" || Array.isArray(patchRaw)) {
      return reply.code(400).send({ error: "patch object required" });
    }

    const patch = patchRaw as Record<string, unknown>;
    const built = await buildMenuItemPatchData(storeId, patch);
    if ("error" in built) return reply.code(400).send({ error: built.error });

    let timeDiscountRows: ValidatedTimeDiscountRow[] | undefined;
    if ("timeDiscounts" in patch) {
      const td = await validateMenuItemTimeDiscountRows(
        storeId,
        patch.timeDiscounts,
        "timeDiscounts must be an array (empty array clears all rows)",
      );
      if ("error" in td) return reply.code(400).send({ error: td.error });
      timeDiscountRows = td.rows;
    }

    let optionGroupIds: string[] | undefined;
    if ("optionGroupIds" in patch) {
      const og = await validateOptionGroupIdsForStore(storeId, patch.optionGroupIds);
      if (!og.ok) return reply.code(400).send({ error: "invalid optionGroupIds" });
      optionGroupIds = og.ids;
    }

    const hasFieldUpdates = Object.keys(built.data).length > 0;
    const hasOptionsUpdate = optionGroupIds !== undefined;
    const hasTimeDiscountUpdate = timeDiscountRows !== undefined;
    if (!hasFieldUpdates && !hasOptionsUpdate && !hasTimeDiscountUpdate) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    if (built.data.sellKind === "set") {
      for (const id of v.ids) {
        const n = await prisma.menuSetStep.count({ where: { setMenuItemId: id } });
        if (n === 0) {
          return reply.code(400).send({
            error: "一括でセットにする商品には、事前にセット構成が保存されている必要があります",
          });
        }
      }
    }

    const needsCategoryReorder =
      hasFieldUpdates &&
      built.data.categoryId !== undefined &&
      !("sortOrder" in patch);

    /** トランザクション内で fs I/O しない（接続／TX が閉じて Transaction not found になる環境がある） */
    const imageUrlsToDeleteAfterTx = new Set<string>();

    await prisma.$transaction(
      async (tx) => {
        let appendBase: number | null = null;
        if (needsCategoryReorder && built.data.categoryId) {
          const max = await tx.menuItem.aggregate({
            where: { categoryId: built.data.categoryId },
            _max: { sortOrder: true },
          });
          appendBase = (max._max.sortOrder ?? -1) + 1;
        }

        const existing = await tx.menuItem.findMany({
          where: { id: { in: v.ids }, category: { storeId } },
          select: { id: true, imageUrl: true },
        });
        const rowById = new Map(existing.map((r) => [r.id, r]));

        for (let i = 0; i < v.ids.length; i++) {
          const id = v.ids[i];
          const row = rowById.get(id);
          if (!row) continue;

          const data: MenuItemPatchData = { ...built.data };
          if (needsCategoryReorder && appendBase !== null) {
            data.sortOrder = appendBase + i;
          }

          const didFieldUpdate = Object.keys(data).length > 0;
          if (didFieldUpdate) {
            if (data.sellKind === "single") {
              await tx.menuSetStep.deleteMany({ where: { setMenuItemId: id } });
            }
            if ("imageUrl" in data && data.imageUrl !== row.imageUrl && row.imageUrl) {
              imageUrlsToDeleteAfterTx.add(row.imageUrl);
            }
            await tx.menuItem.update({
              where: { id },
              data: { ...data, masterVersion: { increment: 1 } },
            });
          }

          if (hasTimeDiscountUpdate && timeDiscountRows !== undefined) {
            await tx.menuItemTimeDiscount.deleteMany({ where: { menuItemId: id } });
            if (timeDiscountRows.length > 0) {
              await tx.menuItemTimeDiscount.createMany({
                data: timeDiscountRows.map((r) => ({
                  menuItemId: id,
                  timeWindowId: r.timeWindowId,
                  discountKind: r.discountKind,
                  value: r.value,
                })),
              });
            }
            if (!didFieldUpdate) {
              await tx.menuItem.update({
                where: { id },
                data: { masterVersion: { increment: 1 } },
              });
            }
          }

          if (hasOptionsUpdate && optionGroupIds !== undefined) {
            await tx.menuItemOptionGroup.deleteMany({ where: { menuItemId: id } });
            if (optionGroupIds.length > 0) {
              await tx.menuItemOptionGroup.createMany({
                data: optionGroupIds.map((optionGroupId, idx) => ({
                  menuItemId: id,
                  optionGroupId,
                  sortOrder: idx,
                })),
              });
            }
          }
        }
      },
      { maxWait: 10_000, timeout: 60_000 }
    );

    for (const url of imageUrlsToDeleteAfterTx) {
      await removeLocalUploadedImage(url);
    }

    return { ok: true, updated: v.ids.length };
  });

  app.put<{
    Params: { storeId: string; itemId: string };
    Body: { discounts?: { timeWindowId: string; discountKind: string; value: number }[] };
  }>("/stores/:storeId/menu/items/:itemId/time-discounts", async (req, reply) => {
    const storeId = req.params.storeId;
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId } },
      select: { id: true, masterVersion: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });
    const bodyObj = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const ifM = readIfMasterVersion(bodyObj);
    if (!(await assertMenuItemMasterVersion(item, ifM, reply))) return;
    const raw = req.body?.discounts;
    const validated = await validateMenuItemTimeDiscountRows(
      storeId,
      raw,
      "discounts[] required (empty array clears)",
    );
    if ("error" in validated) return reply.code(400).send({ error: validated.error });

    await prisma.$transaction(async (tx) => {
      await tx.menuItemTimeDiscount.deleteMany({ where: { menuItemId: item.id } });
      if (validated.rows.length > 0) {
        await tx.menuItemTimeDiscount.createMany({
          data: validated.rows.map((r) => ({
            menuItemId: item.id,
            timeWindowId: r.timeWindowId,
            discountKind: r.discountKind,
            value: r.value,
          })),
        });
      }
      await tx.menuItem.update({
        where: { id: item.id },
        data: { masterVersion: { increment: 1 } },
      });
    });
    const out = await prisma.menuItemTimeDiscount.findMany({
      where: { menuItemId: item.id },
      include: { timeWindow: true },
      orderBy: { id: "asc" },
    });
    return { menuItemId: item.id, timeDiscounts: out };
  });

  app.post<{
    Params: { storeId: string; itemId: string };
  }>("/stores/:storeId/menu/items/:itemId/copy", async (req, reply) => {
    const src = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
      include: {
        optionLinks: { orderBy: { sortOrder: "asc" } },
        timeDiscounts: true,
        setSteps: {
          orderBy: { sortOrder: "asc" },
          include: { choices: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!src) return reply.code(404).send({ error: "item not found" });

    const copied = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.create({
        data: {
          categoryId: src.categoryId,
          name: copiedItemName(src.name),
          description: src.description,
          imageUrl: src.imageUrl,
          recipe: src.recipe,
          price: src.price,
          priceTaxMode: src.priceTaxMode,
          sellKind: src.sellKind === "set" ? "set" : "single",
          sortOrder: (src.sortOrder ?? 0) + 1,
          isAvailable: src.isAvailable,
          stockQty: src.stockQty,
          stockLowThreshold: src.stockLowThreshold,
          kitchenStationId: src.kitchenStationId,
          cookTimerSec: src.cookTimerSec,
          cookTimerSec2: src.cookTimerSec2,
          containsAlcohol: src.containsAlcohol,
        },
      });
      if (src.sellKind === "set" && src.setSteps.length > 0) {
        for (const st of src.setSteps) {
          const step = await tx.menuSetStep.create({
            data: {
              setMenuItemId: item.id,
              label: st.label,
              minPick: st.minPick,
              maxPick: st.maxPick,
              sortOrder: st.sortOrder,
              allowServeLaterSplit: st.allowServeLaterSplit === true,
              serveLaterGroup: normalizeServeLaterGroup(st.serveLaterGroup),
            },
          });
          if (st.choices.length > 0) {
            await tx.menuSetChoice.createMany({
              data: st.choices.map((c) => ({
                stepId: step.id,
                componentMenuItemId: c.componentMenuItemId,
                extraPrice: c.extraPrice,
                sortOrder: c.sortOrder,
                isFixed: c.isFixed === true,
              })),
            });
          }
        }
      }
      if (src.optionLinks.length > 0) {
        await tx.menuItemOptionGroup.createMany({
          data: src.optionLinks.map((l) => ({
            menuItemId: item.id,
            optionGroupId: l.optionGroupId,
            sortOrder: l.sortOrder,
          })),
        });
      }
      if (src.timeDiscounts && src.timeDiscounts.length > 0) {
        await tx.menuItemTimeDiscount.createMany({
          data: src.timeDiscounts.map((d) => ({
            menuItemId: item.id,
            timeWindowId: d.timeWindowId,
            discountKind: d.discountKind,
            value: d.value,
          })),
        });
      }
      return tx.menuItem.findUniqueOrThrow({
        where: { id: item.id },
        include: {
          kitchenStation: { select: { id: true, name: true, active: true } },
          optionLinks: { orderBy: { sortOrder: "asc" }, select: { optionGroupId: true, sortOrder: true } },
          timeDiscounts: { include: { timeWindow: true } },
          setSteps: {
            orderBy: { sortOrder: "asc" },
            include: {
              choices: {
                orderBy: { sortOrder: "asc" },
                include: {
                  componentMenuItem: {
                    select: { id: true, name: true, sellKind: true, isAvailable: true, price: true, priceTaxMode: true },
                  },
                },
              },
            },
          },
        },
      });
    });
    return copied;
  });

  app.delete<{
    Params: { storeId: string; itemId: string };
  }>("/stores/:storeId/menu/items/:itemId", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
      select: { id: true, imageUrl: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });
    await prisma.$transaction(async (tx) => {
      await tx.menuItem.delete({ where: { id: item.id } });
      await pruneOrphanSetStructure(tx);
    });
    await removeLocalUploadedImage(item.imageUrl);
    return { ok: true, deletedItemId: item.id };
  });

  app.get<{
    Params: { storeId: string };
    Querystring: { all?: string };
  }>("/stores/:storeId/courses", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const includeInactive = req.query.all === "1" || req.query.all === "true";
    const courses = await prisma.course.findMany({
      where: includeInactive ? { storeId: store.id } : { storeId: store.id, active: true },
      orderBy: { name: "asc" },
      include: {
        includedItems: { select: { menuItemId: true, minGuestCount: true } },
        priceTiers: { orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }] },
        optionPacks: {
          orderBy: { sortOrder: "asc" },
          include: { menuItems: { select: { menuItemId: true } } },
        },
      },
    });
    return {
      storeId: store.id,
      courses: courses.map((c) => mapCourseWithItems(c)),
    };
  });

  app.post<{
    Params: { storeId: string };
    Body: {
      name: string;
      kind: string;
      priceTiers: unknown;
      menuItemIds?: unknown;
      includedMenuLinks?: unknown;
      optionPacks?: unknown;
    };
  }>("/stores/:storeId/courses", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    const kind = req.body?.kind?.trim();
    if (!name || !kind) return reply.code(400).send({ error: "name and kind required" });
    const pt = normalizePriceTiersInput(req.body?.priceTiers);
    if (!pt.ok) return reply.code(400).send({ error: pt.error });

    let linksToCreate: CourseMenuLinkIn[] = [];
    if (req.body && typeof req.body === "object") {
      const b = req.body as Record<string, unknown>;
      if (Array.isArray(b.includedMenuLinks)) {
        const v = await validateCourseMenuLinks(store.id, b.includedMenuLinks);
        if (!v.ok) return reply.code(400).send({ error: v.error });
        linksToCreate = v.links;
      } else if ("menuItemIds" in b) {
        const v = await validateCourseMenuItemIds(store.id, b.menuItemIds);
        if (!v.ok) return reply.code(400).send({ error: v.error });
        linksToCreate = v.ids.map((menuItemId) => ({ menuItemId, minGuestCount: 1 }));
      }
    }

    let optionPacksToCreate: CourseOptionPackIn[] = [];
    if (req.body && typeof req.body === "object" && "optionPacks" in req.body) {
      const b = req.body as Record<string, unknown>;
      const v = await validateCourseOptionPacks(store.id, b.optionPacks);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      optionPacksToCreate = v.packs;
    }

    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.course.create({
        data: {
          storeId: store.id,
          name,
          kind,
        },
      });
      await tx.coursePriceTier.createMany({
        data: pt.tiers.map((t, idx) => ({
          courseId: c.id,
          durationMinutes: t.durationMinutes,
          pricePerPerson: t.pricePerPerson,
          childPricePerPerson:
            t.childPricePerPerson !== undefined ? t.childPricePerPerson : null,
          sortOrder: t.sortOrder ?? idx,
        })),
      });
      if (linksToCreate.length > 0) {
        await tx.courseMenuItem.createMany({
          data: linksToCreate.map((l) => ({
            courseId: c.id,
            menuItemId: l.menuItemId,
            minGuestCount: l.minGuestCount,
          })),
        });
      }
      for (const p of optionPacksToCreate) {
        await tx.courseOptionPack.create({
          data: {
            courseId: c.id,
            name: p.name,
            chargeScope: p.chargeScope,
            extraPrice: p.extraPrice,
            extraPriceTaxMode: p.extraPriceTaxMode,
            sortOrder: p.sortOrder,
            menuItems: {
              createMany: {
                data: p.menuItemIds.map((menuItemId) => ({ menuItemId })),
              },
            },
          },
        });
      }
      return tx.course.findUniqueOrThrow({
        where: { id: c.id },
        include: {
          includedItems: { select: { menuItemId: true, minGuestCount: true } },
          priceTiers: { orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }] },
          optionPacks: {
            orderBy: { sortOrder: "asc" },
            include: { menuItems: { select: { menuItemId: true } } },
          },
        },
      });
    });
    return mapCourseWithItems(course);
  });

  app.patch<{
    Params: { storeId: string; courseId: string };
    Body: {
      name?: string;
      kind?: string;
      active?: boolean;
      menuItemIds?: unknown;
      includedMenuLinks?: unknown;
      priceTiers?: unknown;
      optionPacks?: unknown;
    };
  }>("/stores/:storeId/courses/:courseId", async (req, reply) => {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, storeId: req.params.storeId },
    });
    if (!course) return reply.code(404).send({ error: "course not found" });
    const data: {
      name?: string;
      kind?: string;
      active?: boolean;
    } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.kind === "string") {
      const k = req.body.kind.trim();
      if (!k) return reply.code(400).send({ error: "kind cannot be empty" });
      data.kind = k;
    }
    if (typeof req.body?.active === "boolean") {
      data.active = req.body.active;
    }

    const bodyObj = req.body && typeof req.body === "object" ? req.body : null;
    const syncMenu =
      bodyObj !== null && ("menuItemIds" in bodyObj || "includedMenuLinks" in bodyObj);
    const syncTiers = bodyObj !== null && "priceTiers" in bodyObj;
    const syncOptionPacks = bodyObj !== null && "optionPacks" in bodyObj;
    let linkPayload: CourseMenuLinkIn[] | null = null;
    if (syncMenu) {
      const b = bodyObj as Record<string, unknown>;
      if (Array.isArray(b.includedMenuLinks)) {
        const v = await validateCourseMenuLinks(req.params.storeId, b.includedMenuLinks);
        if (!v.ok) return reply.code(400).send({ error: v.error });
        linkPayload = v.links;
      } else {
        const v = await validateCourseMenuItemIds(req.params.storeId, b.menuItemIds);
        if (!v.ok) return reply.code(400).send({ error: v.error });
        linkPayload = v.ids.map((menuItemId) => ({ menuItemId, minGuestCount: 1 }));
      }
    }
    let replaceTiers: PriceTierInput[] | null = null;
    if (syncTiers) {
      const tr = normalizePriceTiersInput(bodyObj!.priceTiers);
      if (!tr.ok) return reply.code(400).send({ error: tr.error });
      replaceTiers = tr.tiers;
    }
    let optionPacksPayload: CourseOptionPackIn[] | null = null;
    if (syncOptionPacks) {
      const v = await validateCourseOptionPacks(req.params.storeId, bodyObj!.optionPacks);
      if (!v.ok) return reply.code(400).send({ error: v.error });
      optionPacksPayload = v.packs;
    }

    if (Object.keys(data).length === 0 && !syncMenu && !syncTiers && !syncOptionPacks) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    await prisma.$transaction(async (tx) => {
      if (syncTiers && replaceTiers) {
        const sessionsWithDm = await tx.diningSession.findMany({
          where: { courseId: course.id, coursePriceTierId: { not: null } },
          select: { id: true, coursePriceTier: { select: { durationMinutes: true } } },
        });
        const durationBySession = new Map<string, number>();
        for (const s of sessionsWithDm) {
          const dm = s.coursePriceTier?.durationMinutes;
          if (dm != null) durationBySession.set(s.id, dm);
        }
        await tx.coursePriceTier.deleteMany({ where: { courseId: course.id } });
        await tx.coursePriceTier.createMany({
          data: replaceTiers.map((t, idx) => ({
            courseId: course.id,
            durationMinutes: t.durationMinutes,
            pricePerPerson: t.pricePerPerson,
            childPricePerPerson:
              t.childPricePerPerson !== undefined ? t.childPricePerPerson : null,
            sortOrder: t.sortOrder ?? idx,
          })),
        });
        const newTiers = await tx.coursePriceTier.findMany({
          where: { courseId: course.id },
          select: { id: true, durationMinutes: true },
        });
        const tierIdByDuration = new Map(newTiers.map((x) => [x.durationMinutes, x.id]));
        for (const [sid, dm] of durationBySession) {
          const nid = tierIdByDuration.get(dm);
          if (nid) {
            await tx.diningSession.update({
              where: { id: sid },
              data: { coursePriceTierId: nid },
            });
          }
        }
      }
      if (Object.keys(data).length > 0) {
        await tx.course.update({ where: { id: course.id }, data });
      }
      if (linkPayload !== null) {
        await tx.courseMenuItem.deleteMany({ where: { courseId: course.id } });
        if (linkPayload.length > 0) {
          await tx.courseMenuItem.createMany({
            data: linkPayload.map((l) => ({
              courseId: course.id,
              menuItemId: l.menuItemId,
              minGuestCount: l.minGuestCount,
            })),
          });
        }
      }
      if (syncOptionPacks && optionPacksPayload !== null) {
        await tx.courseOptionPack.deleteMany({ where: { courseId: course.id } });
        for (const p of optionPacksPayload) {
          await tx.courseOptionPack.create({
            data: {
              courseId: course.id,
              name: p.name,
              chargeScope: p.chargeScope,
              extraPrice: p.extraPrice,
              extraPriceTaxMode: p.extraPriceTaxMode,
              sortOrder: p.sortOrder,
              menuItems: {
                createMany: {
                  data: p.menuItemIds.map((menuItemId) => ({ menuItemId })),
                },
              },
            },
          });
        }
      }
    });

    const updated = await prisma.course.findUniqueOrThrow({
      where: { id: course.id },
      include: {
        includedItems: { select: { menuItemId: true, minGuestCount: true } },
        priceTiers: { orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }] },
        optionPacks: {
          orderBy: { sortOrder: "asc" },
          include: { menuItems: { select: { menuItemId: true } } },
        },
      },
    });
    return mapCourseWithItems(updated);
  });

  app.delete<{
    Params: { storeId: string; courseId: string };
  }>("/stores/:storeId/courses/:courseId", async (req, reply) => {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, storeId: req.params.storeId },
      select: { id: true },
    });
    if (!course) return reply.code(404).send({ error: "course not found" });
    await prisma.course.delete({ where: { id: course.id } });
    return { ok: true, deletedCourseId: course.id };
  });
}
