import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

function maskDevice(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…" + id.slice(-4);
}

export async function registerCustomers(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { limit?: string };
  }>("/stores/:storeId/customers", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const limitRaw = req.query.limit ?? "50";
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 50));

    const rows = await prisma.customer.findMany({
      where: { storeId: store.id },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });

    return {
      storeId: store.id,
      customers: rows.map((c) => ({
        id: c.id,
        deviceIdMasked: maskDevice(c.deviceId),
        name: c.name,
        phone: c.phone,
        visitCount: c.visitCount,
        lastSeenAt: c.lastSeenAt,
        createdAt: c.createdAt,
      })),
    };
  });

  /** ハンディ用：累計よく注文する商品・最近の注文履歴 */
  app.get<{ Params: { storeId: string; customerId: string } }>(
    "/stores/:storeId/customers/:customerId/insights",
    async (req, reply) => {
      const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });

      const customer = await prisma.customer.findFirst({
        where: { id: req.params.customerId, storeId: store.id },
      });
      if (!customer) return reply.code(404).send({ error: "customer not found" });

      const rankingRows = await prisma.$queryRaw<
        { menu_item_id: string | null; label: string | null; total_qty: bigint | number }[]
      >(
        Prisma.sql`
          SELECT ol."menuItemId" AS menu_item_id,
                 MIN(ol."nameSnapshot") AS label,
                 SUM(ol.qty)::bigint AS total_qty
          FROM "OrderLine" ol
          INNER JOIN "SalesOrder" so ON so.id = ol."orderId"
          INNER JOIN "DiningSession" ds ON ds.id = so."sessionId"
          WHERE ds."customerId" = ${customer.id}
            AND ds."storeId" = ${store.id}
            AND ol.status <> 'cancelled'
            AND ol."menuItemId" IS NOT NULL
          GROUP BY ol."menuItemId"
          ORDER BY SUM(ol.qty) DESC
          LIMIT 10
        `,
      );

      const orderRanking = rankingRows.map((r, i) => ({
        rank: i + 1,
        menuItemId: r.menu_item_id,
        label: r.label || "商品",
        totalQty: Number(r.total_qty),
      }));

      const recentOrdersRaw = await prisma.salesOrder.findMany({
        where: {
          session: { customerId: customer.id, storeId: store.id },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: {
          session: {
            include: { table: { select: { name: true, publicCode: true } } },
          },
          lines: {
            where: { status: { not: "cancelled" } },
            select: { nameSnapshot: true, qty: true },
          },
        },
      });

      const recentOrders = recentOrdersRaw.map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        tableName: o.session.table?.name ?? "卓",
        lines: o.lines.map((l) => ({ nameSnapshot: l.nameSnapshot, qty: l.qty })),
      }));

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          deviceIdMasked: maskDevice(customer.deviceId),
          visitCount: customer.visitCount,
          lastSeenAt: customer.lastSeenAt,
          createdAt: customer.createdAt,
        },
        orderRanking,
        recentOrders,
      };
    },
  );
}
