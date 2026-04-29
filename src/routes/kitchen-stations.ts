import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function registerKitchenStations(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { all?: string };
  }>("/stores/:storeId/kitchen-stations", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const all = req.query.all === "1" || req.query.all === "true";
    const stations = await prisma.kitchenStation.findMany({
      where: { storeId: store.id, ...(all ? {} : { active: true }) },
      orderBy: { sortOrder: "asc" },
    });
    return { storeId: store.id, stations };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; sortOrder?: number };
  }>("/stores/:storeId/kitchen-stations", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const row = await prisma.kitchenStation.create({
      data: {
        storeId: store.id,
        name,
        sortOrder: req.body?.sortOrder ?? 0,
      },
    });
    return row;
  });

  app.patch<{
    Params: { storeId: string; stationId: string };
    Body: { name?: string; sortOrder?: number; active?: boolean };
  }>("/stores/:storeId/kitchen-stations/:stationId", async (req, reply) => {
    const row = await prisma.kitchenStation.findFirst({
      where: { id: req.params.stationId, storeId: req.params.storeId },
    });
    if (!row) return reply.code(404).send({ error: "station not found" });
    const data: { name?: string; sortOrder?: number; active?: boolean } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (typeof req.body?.active === "boolean") {
      data.active = req.body.active;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    return prisma.kitchenStation.update({ where: { id: row.id }, data });
  });
}
