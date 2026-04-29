import type { FastifyInstance } from "fastify";
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
          },
        },
      },
    });
    return { storeId: store.id, categories };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; sortOrder?: number; visibleToGuest?: boolean };
  }>("/stores/:storeId/menu/categories", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const visibleToGuest = req.body?.visibleToGuest === false ? false : true;
    const cat = await prisma.menuCategory.create({
      data: {
        storeId: store.id,
        name,
        sortOrder: req.body?.sortOrder ?? 0,
        visibleToGuest,
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
      sortOrder?: number;
      kitchenStationId?: string | null;
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
    const item = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name,
        price,
        description: req.body?.description?.trim() || null,
        sortOrder: req.body?.sortOrder ?? 0,
        kitchenStationId,
      },
    });
    return item;
  });

  app.patch<{
    Params: { storeId: string; categoryId: string };
    Body: { name?: string; sortOrder?: number; visibleToGuest?: boolean };
  }>("/stores/:storeId/menu/categories/:categoryId", async (req, reply) => {
    const cat = await prisma.menuCategory.findFirst({
      where: { id: req.params.categoryId, storeId: req.params.storeId },
    });
    if (!cat) return reply.code(404).send({ error: "category not found" });
    const data: { name?: string; sortOrder?: number; visibleToGuest?: boolean } = {};
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
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    const updated = await prisma.menuCategory.update({ where: { id: cat.id }, data });
    return updated;
  });

  app.patch<{
    Params: { storeId: string; itemId: string };
    Body: {
      name?: string;
      price?: number;
      description?: string | null;
      sortOrder?: number;
      isAvailable?: boolean;
      categoryId?: string;
      kitchenStationId?: string | null;
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
      sortOrder?: number;
      isAvailable?: boolean;
      categoryId?: string;
      kitchenStationId?: string | null;
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

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.menuItem.update({
      where: { id: item.id },
      data,
    });
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
