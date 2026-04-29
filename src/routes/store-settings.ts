import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { mergeStoreSettings } from "../lib/store-settings.js";

export async function registerStoreSettings(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/settings", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const settings = mergeStoreSettings(store.settings);
    return {
      store: { id: store.id, name: store.name, settings },
    };
  });

  app.patch<{
    Params: { storeId: string };
    Body: { name?: string; settings?: Record<string, unknown> };
  }>("/stores/:storeId/settings", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const data: { name?: string; settings?: object } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (req.body?.settings !== undefined) {
      if (!req.body.settings || typeof req.body.settings !== "object" || Array.isArray(req.body.settings)) {
        return reply.code(400).send({ error: "settings must be an object" });
      }
      const cur = mergeStoreSettings(store.settings);
      const next = mergeStoreSettings({ ...cur, ...req.body.settings });
      data.settings = next;
    }

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.store.update({
      where: { id: store.id },
      data,
    });
    return {
      store: {
        id: updated.id,
        name: updated.name,
        settings: mergeStoreSettings(updated.settings),
      },
    };
  });

  app.get<{ Params: { storeId: string } }>("/stores/:storeId/staff-users", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const staffUsers = await prisma.staffUser.findMany({
      where: { storeId: store.id },
      orderBy: { email: "asc" },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    return { storeId: store.id, staffUsers };
  });

  app.patch<{
    Params: { storeId: string; storePaymentMethodId: string };
    Body: { enabled?: boolean; sortOrder?: number };
  }>("/stores/:storeId/payment-methods/:storePaymentMethodId", async (req, reply) => {
    const row = await prisma.storePaymentMethod.findFirst({
      where: { id: req.params.storePaymentMethodId, storeId: req.params.storeId },
      include: { definition: true },
    });
    if (!row) return reply.code(404).send({ error: "payment method row not found" });

    const data: { enabled?: boolean; sortOrder?: number } = {};
    if (typeof req.body?.enabled === "boolean") {
      data.enabled = req.body.enabled;
    }
    if (typeof req.body?.sortOrder === "number") {
      if (!Number.isInteger(req.body.sortOrder)) {
        return reply.code(400).send({ error: "sortOrder must be integer" });
      }
      data.sortOrder = req.body.sortOrder;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.storePaymentMethod.update({
      where: { id: row.id },
      data,
    });
    return {
      id: updated.id,
      code: row.definition.code,
      labelJa: row.definition.labelJa,
      enabled: updated.enabled,
      sortOrder: updated.sortOrder,
    };
  });
}
