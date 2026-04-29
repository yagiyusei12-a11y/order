import type { FastifyInstance } from "fastify";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
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

function mapCourseWithItems<T extends { includedItems: { menuItemId: string }[] }>(
  c: T
): Omit<T, "includedItems"> & { includedMenuItemIds: string[] } {
  const { includedItems, ...rest } = c;
  return { ...rest, includedMenuItemIds: includedItems.map((x) => x.menuItemId) };
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
    return { storeId: store.id, categories };
  });

  /** スタッフ用：販売停止含む全カテゴリ・全商品 */
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/menu/full", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const categories = await prisma.menuCategory.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            kitchenStation: { select: { id: true, name: true, active: true } },
            optionLinks: {
              orderBy: { sortOrder: "asc" },
              select: { optionGroupId: true, sortOrder: true },
            },
          },
        },
      },
    });
    return { storeId: store.id, categories };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; sortOrder?: number; visibleToGuest?: boolean; parentId?: string | null };
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
    const cat = await prisma.menuCategory.create({
      data: {
        storeId: store.id,
        name,
        sortOrder: req.body?.sortOrder ?? 0,
        visibleToGuest,
        parentId,
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
      description?: string;
      imageUrl?: string | null;
      sortOrder?: number;
      kitchenStationId?: string | null;
      stockQty?: number | null;
      stockLowThreshold?: number | null;
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
    let imageUrl: string | null | undefined = undefined;
    if (req.body && "imageUrl" in req.body) {
      if (req.body.imageUrl === null) imageUrl = null;
      else if (typeof req.body.imageUrl === "string") {
        const u = req.body.imageUrl.trim();
        imageUrl = u || null;
      } else return reply.code(400).send({ error: "imageUrl must be string or null" });
    }
    const item = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name,
        price,
        description: req.body?.description?.trim() || null,
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        sortOrder: req.body?.sortOrder ?? 0,
        kitchenStationId,
        ...(stockQty !== undefined ? { stockQty } : {}),
        ...(stockLowThreshold !== undefined ? { stockLowThreshold } : {}),
      },
    });
    return item;
  });

  app.patch<{
    Params: { storeId: string; categoryId: string };
    Body: { name?: string; sortOrder?: number; visibleToGuest?: boolean; parentId?: string | null };
  }>("/stores/:storeId/menu/categories/:categoryId", async (req, reply) => {
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
    });
    if (!cat) return reply.code(404).send({ error: "category not found" });
    const data: { name?: string; sortOrder?: number; visibleToGuest?: boolean; parentId?: string | null } = {};
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
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    const updated = await prisma.menuCategory.update({ where: { id: cat.id }, data });
    return updated;
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
    });
    if (!item) return reply.code(404).send({ error: "item not found" });
    const v = await validateOptionGroupIdsForStore(req.params.storeId, req.body?.optionGroupIds);
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
      data: { imageUrl },
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
      data: { imageUrl: null },
    });
    await removeLocalUploadedImage(item.imageUrl);
    return { ok: true };
  });

  app.patch<{
    Params: { storeId: string; itemId: string };
    Body: {
      name?: string;
      price?: number;
      description?: string | null;
      imageUrl?: string | null;
      sortOrder?: number;
      isAvailable?: boolean;
      categoryId?: string;
      kitchenStationId?: string | null;
      stockQty?: number | null;
      stockLowThreshold?: number | null;
    };
  }>("/stores/:storeId/menu/items/:itemId", async (req, reply) => {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, category: { storeId: req.params.storeId } },
      include: { category: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });

    const data: {
      name?: string;
      price?: number;
      description?: string | null;
      imageUrl?: string | null;
      sortOrder?: number;
      isAvailable?: boolean;
      categoryId?: string;
      kitchenStationId?: string | null;
      stockQty?: number | null;
      stockLowThreshold?: number | null;
    } = {};
    if (req.body?.categoryId !== undefined) {
      const cat = await prisma.menuCategory.findFirst({
        where: { id: req.body.categoryId, storeId: req.params.storeId },
      });
      if (!cat) return reply.code(400).send({ error: "category not found" });
      data.categoryId = cat.id;
    }
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.price === "number") {
      if (!Number.isInteger(req.body.price) || req.body.price < 0) {
        return reply.code(400).send({ error: "price must be non-negative integer" });
      }
      data.price = req.body.price;
    }
    if (req.body?.description !== undefined) {
      data.description =
        typeof req.body.description === "string" ? req.body.description.trim() || null : null;
    }
    if (req.body?.imageUrl !== undefined) {
      data.imageUrl =
        typeof req.body.imageUrl === "string" ? req.body.imageUrl.trim() || null : null;
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.isAvailable === "boolean") {
      data.isAvailable = req.body.isAvailable;
    }
    if (req.body?.kitchenStationId !== undefined) {
      if (req.body.kitchenStationId === null) {
        data.kitchenStationId = null;
      } else if (typeof req.body.kitchenStationId === "string") {
        const sid = req.body.kitchenStationId.trim();
        if (!sid) {
          data.kitchenStationId = null;
        } else {
          const ok = await assertKitchenStationForStore(req.params.storeId, sid);
          if (!ok.ok) return reply.code(400).send({ error: "kitchenStation not found" });
          data.kitchenStationId = sid;
        }
      }
    }
    if (req.body && "stockQty" in req.body) {
      const v = req.body.stockQty;
      if (v === null) data.stockQty = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 0) data.stockQty = v;
      else return reply.code(400).send({ error: "stockQty must be null or non-negative integer" });
    }
    if (req.body && "stockLowThreshold" in req.body) {
      const v = req.body.stockLowThreshold;
      if (v === null) data.stockLowThreshold = null;
      else if (typeof v === "number" && Number.isInteger(v) && v >= 0) data.stockLowThreshold = v;
      else {
        return reply.code(400).send({ error: "stockLowThreshold must be null or non-negative integer" });
      }
    }

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const prevImageUrl = item.imageUrl;
    const updated = await prisma.menuItem.update({
      where: { id: item.id },
      data,
    });
    if ("imageUrl" in data && data.imageUrl !== prevImageUrl) {
      await removeLocalUploadedImage(prevImageUrl);
    }
    return updated;
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
      include: { includedItems: { select: { menuItemId: true } } },
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
      durationMinutes: number;
      pricePerPerson: number;
      menuItemIds?: unknown;
    };
  }>("/stores/:storeId/courses", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    const kind = req.body?.kind?.trim();
    const dm = req.body?.durationMinutes;
    const pp = req.body?.pricePerPerson;
    if (!name || !kind) return reply.code(400).send({ error: "name and kind required" });
    if (typeof dm !== "number" || dm <= 0 || !Number.isInteger(dm)) {
      return reply.code(400).send({ error: "durationMinutes must be positive integer" });
    }
    if (typeof pp !== "number" || pp < 0 || !Number.isInteger(pp)) {
      return reply.code(400).send({ error: "pricePerPerson must be non-negative integer" });
    }

    let linkIds: string[] = [];
    if (req.body && typeof req.body === "object" && "menuItemIds" in req.body) {
      const v = await validateMenuItemIdsForStore(store.id, req.body.menuItemIds);
      if (!v.ok) return reply.code(400).send({ error: "invalid menuItemIds" });
      linkIds = v.ids;
    }

    const course = await prisma.$transaction(async (tx) => {
      const c = await tx.course.create({
        data: {
          storeId: store.id,
          name,
          kind,
          durationMinutes: dm,
          pricePerPerson: pp,
        },
      });
      if (linkIds.length > 0) {
        await tx.courseMenuItem.createMany({
          data: linkIds.map((menuItemId) => ({ courseId: c.id, menuItemId })),
        });
      }
      return tx.course.findUniqueOrThrow({
        where: { id: c.id },
        include: { includedItems: { select: { menuItemId: true } } },
      });
    });
    return mapCourseWithItems(course);
  });

  app.patch<{
    Params: { storeId: string; courseId: string };
    Body: {
      name?: string;
      kind?: string;
      durationMinutes?: number;
      pricePerPerson?: number;
      active?: boolean;
      menuItemIds?: unknown;
    };
  }>("/stores/:storeId/courses/:courseId", async (req, reply) => {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, storeId: req.params.storeId },
    });
    if (!course) return reply.code(404).send({ error: "course not found" });
    const data: {
      name?: string;
      kind?: string;
      durationMinutes?: number;
      pricePerPerson?: number;
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
    if (typeof req.body?.durationMinutes === "number") {
      if (!Number.isInteger(req.body.durationMinutes) || req.body.durationMinutes <= 0) {
        return reply.code(400).send({ error: "durationMinutes must be positive integer" });
      }
      data.durationMinutes = req.body.durationMinutes;
    }
    if (typeof req.body?.pricePerPerson === "number") {
      if (!Number.isInteger(req.body.pricePerPerson) || req.body.pricePerPerson < 0) {
        return reply.code(400).send({ error: "pricePerPerson must be non-negative integer" });
      }
      data.pricePerPerson = req.body.pricePerPerson;
    }
    if (typeof req.body?.active === "boolean") {
      data.active = req.body.active;
    }

    const bodyObj = req.body && typeof req.body === "object" ? req.body : null;
    const syncMenu = bodyObj !== null && "menuItemIds" in bodyObj;
    let linkIds: string[] | null = null;
    if (syncMenu) {
      const v = await validateMenuItemIdsForStore(req.params.storeId, bodyObj.menuItemIds);
      if (!v.ok) return reply.code(400).send({ error: "invalid menuItemIds" });
      linkIds = v.ids;
    }

    if (Object.keys(data).length === 0 && !syncMenu) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.course.update({ where: { id: course.id }, data });
      }
      if (linkIds !== null) {
        await tx.courseMenuItem.deleteMany({ where: { courseId: course.id } });
        if (linkIds.length > 0) {
          await tx.courseMenuItem.createMany({
            data: linkIds.map((menuItemId) => ({ courseId: course.id, menuItemId })),
          });
        }
      }
    });

    const updated = await prisma.course.findUniqueOrThrow({
      where: { id: course.id },
      include: { includedItems: { select: { menuItemId: true } } },
    });
    return mapCourseWithItems(updated);
  });
}
