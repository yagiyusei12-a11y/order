import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { newPublicCode } from "../lib/token.js";

export async function registerTables(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/tables", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tables = await prisma.table.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: "asc" },
    });
    return { storeId: store.id, tables };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; publicCode?: string; sortOrder?: number };
  }>("/stores/:storeId/tables", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    let code = req.body?.publicCode?.trim();
    if (!code) {
      for (let i = 0; i < 5; i++) {
        code = newPublicCode();
        const clash = await prisma.table.findUnique({ where: { publicCode: code } });
        if (!clash) break;
      }
    }
    if (!code) return reply.code(500).send({ error: "could not allocate publicCode" });
    const existing = await prisma.table.findUnique({ where: { publicCode: code } });
    if (existing) return reply.code(400).send({ error: "publicCode already in use" });
    const table = await prisma.table.create({
      data: {
        storeId: store.id,
        name,
        publicCode: code,
        sortOrder: req.body?.sortOrder ?? 0,
      },
    });
    return table;
  });

  app.patch<{
    Params: { storeId: string; tableId: string };
    Body: { name?: string; active?: boolean; sortOrder?: number };
  }>("/stores/:storeId/tables/:tableId", async (req, reply) => {
    const t = await prisma.table.findFirst({
      where: { id: req.params.tableId, storeId: req.params.storeId },
    });
    if (!t) return reply.code(404).send({ error: "table not found" });
    const data: { name?: string; active?: boolean; sortOrder?: number } = {};
    if (req.body?.name !== undefined) {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.active === "boolean") data.active = req.body.active;
    if (typeof req.body?.sortOrder === "number") data.sortOrder = req.body.sortOrder;
    const updated = await prisma.table.update({ where: { id: t.id }, data });
    return updated;
  });
}
