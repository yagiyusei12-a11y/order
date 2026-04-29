import type { FastifyInstance } from "fastify";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { prisma } from "../db.js";

export async function registerGuest(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/guest/:token/menu", async (req, reply) => {
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      include: {
        course: {
          include: { includedItems: { select: { menuItemId: true } } },
        },
      },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }

    const restricted =
      session.course &&
      session.course.includedItems &&
      session.course.includedItems.length > 0;
    const allowedIds = restricted
      ? new Set(session.course!.includedItems.map((x) => x.menuItemId))
      : null;

    const categories = await prisma.menuCategory.findMany({
      where: { storeId: session.storeId, visibleToGuest: true },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          where: {
            isAvailable: true,
            ...(allowedIds ? { id: { in: [...allowedIds] } } : {}),
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    const categoriesFiltered = categories.filter((c) => c.items.length > 0);

    const courseOut = session.course
      ? {
          id: session.course.id,
          name: session.course.name,
          kind: session.course.kind,
          durationMinutes: session.course.durationMinutes,
          pricePerPerson: session.course.pricePerPerson,
          restrictedToMenuItems: Boolean(restricted),
        }
      : null;

    const storeRow = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);

    return {
      session: {
        id: session.id,
        guestCount: session.guestCount,
        course: courseOut,
      },
      store: {
        showMenuPrices: st.guestShowMenuPrices,
      },
      categories: categoriesFiltered,
    };
  });

  app.post<{
    Params: { token: string };
    Body: { lines: { menuItemId: string; qty: number; note?: string }[]; note?: string };
  }>("/guest/:token/orders", async (req, reply) => {
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }

    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: "lines[] required" });
    }

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { id: session.id },
          include: {
            course: {
              include: { includedItems: { select: { menuItemId: true } } },
            },
          },
        });
        const restricted =
          sess?.course && sess.course.includedItems && sess.course.includedItems.length > 0;
        const allowedIds = restricted
          ? new Set(sess!.course!.includedItems.map((x) => x.menuItemId))
          : null;

        const so = await tx.salesOrder.create({
          data: {
            sessionId: session.id,
            status: "submitted",
            note: req.body?.note?.trim() || null,
          },
        });

        for (const l of lines) {
          if (typeof l.qty !== "number" || l.qty < 1 || !Number.isInteger(l.qty)) {
            throw new Error("BAD_QTY");
          }
          if (allowedIds && !allowedIds.has(l.menuItemId)) {
            throw new Error("BAD_ITEM");
          }
          const item = await tx.menuItem.findFirst({
            where: {
              id: l.menuItemId,
              isAvailable: true,
              category: { storeId: session.storeId, visibleToGuest: true },
            },
          });
          if (!item) throw new Error("BAD_ITEM");
          await tx.orderLine.create({
            data: {
              orderId: so.id,
              menuItemId: item.id,
              nameSnapshot: item.name,
              unitPrice: item.price,
              qty: l.qty,
              note: l.note?.trim() || null,
              status: "queued",
            },
          });
        }

        return tx.salesOrder.findUnique({
          where: { id: so.id },
          include: { lines: true },
        });
      });
      return order;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "invalid qty" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "invalid or unavailable menuItemId" });
      throw e;
    }
  });

  app.get<{ Params: { token: string } }>("/guest/:token/orders", async (req, reply) => {
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const orders = await prisma.salesOrder.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      include: { lines: true },
    });
    return { orders };
  });
}
