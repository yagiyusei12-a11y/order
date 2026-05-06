import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { newPublicCode } from "../lib/token.js";
import type { Prisma } from "@prisma/client";

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

  app.post<{
    Params: { storeId: string };
    Body: { orderedIds: string[] };
  }>("/stores/:storeId/tables/reorder", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return reply.code(400).send({ error: "orderedIds required" });
    }
    const tables = await prisma.table.findMany({
      where: { storeId: store.id },
      select: { id: true },
    });
    if (orderedIds.length !== tables.length) {
      return reply
        .code(400)
        .send({ error: "orderedIds must list every table in this store exactly once" });
    }
    const idSet = new Set(tables.map((x) => x.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (typeof id !== "string" || !idSet.has(id) || seen.has(id)) {
        return reply.code(400).send({ error: "invalid or duplicate id in orderedIds" });
      }
      seen.add(id);
    }
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.table.update({
          where: { id },
          data: { sortOrder: index + 1 },
        }),
      ),
    );
    return { ok: true };
  });

  app.patch<{
    Params: { storeId: string; tableId: string };
    Body: { name?: string; active?: boolean; sortOrder?: number; capacity?: unknown; mergeWith?: unknown };
  }>("/stores/:storeId/tables/:tableId", async (req, reply) => {
    const t = await prisma.table.findFirst({
      where: { id: req.params.tableId, storeId: req.params.storeId },
    });
    if (!t) return reply.code(404).send({ error: "table not found" });
    const data: { name?: string; active?: boolean; sortOrder?: number; capacity?: number; mergeWith?: Prisma.InputJsonValue } = {};
    if (req.body?.name !== undefined) {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (typeof req.body?.active === "boolean") data.active = req.body.active;
    if (typeof req.body?.sortOrder === "number") data.sortOrder = req.body.sortOrder;
    if (req.body?.capacity !== undefined) {
      const cap = typeof req.body.capacity === "number" ? req.body.capacity : Number(req.body.capacity);
      if (!Number.isFinite(cap) || cap < 1 || cap > 99) return reply.code(400).send({ error: "capacity must be 1..99" });
      data.capacity = Math.floor(cap);
    }
    if (req.body?.mergeWith !== undefined) {
      // Expect array of publicCodes (strings). Stored as JSON.
      const arr = Array.isArray(req.body.mergeWith) ? req.body.mergeWith : [];
      const cleaned = arr.filter((x) => typeof x === "string").map((s) => s.trim()).filter((s) => s);
      data.mergeWith = cleaned as Prisma.InputJsonValue;
    }
    const updated = await prisma.table.update({ where: { id: t.id }, data });
    return updated;
  });

  app.delete<{ Params: { storeId: string; tableId: string } }>(
    "/stores/:storeId/tables/:tableId",
    async (req, reply) => {
      const t = await prisma.table.findFirst({
        where: { id: req.params.tableId, storeId: req.params.storeId },
      });
      if (!t) return reply.code(404).send({ error: "table not found" });
      const openSessions = await prisma.diningSession.count({
        where: { tableId: t.id, status: "open" },
      });
      if (openSessions > 0) {
        return reply
          .code(409)
          .send({ error: "この卓に開いている滞在があるため削除できません。会計を終えてから再度お試しください。" });
      }
      await prisma.table.delete({ where: { id: t.id } });
      return { ok: true };
    },
  );
}
