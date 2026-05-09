import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { assertManagerRole } from "../lib/staff-role.js";

function validateMinPair(startMin: unknown, endMin: unknown): { ok: true; startMin: number; endMin: number } | { ok: false; error: string } {
  if (typeof startMin !== "number" || !Number.isInteger(startMin) || startMin < 0 || startMin > 1439) {
    return { ok: false, error: "startMin must be integer 0-1439" };
  }
  if (typeof endMin !== "number" || !Number.isInteger(endMin) || endMin < 0 || endMin > 1439) {
    return { ok: false, error: "endMin must be integer 0-1439" };
  }
  return { ok: true, startMin, endMin };
}

export async function registerTimeWindows(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/time-windows", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const rows = await prisma.storeTimeWindow.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: "asc" },
    });
    return { storeId: store.id, timeWindows: rows };
  });

  app.post<{
    Params: { storeId: string };
    Body: { name: string; startMin: number; endMin: number; sortOrder?: number };
  }>("/stores/:storeId/time-windows", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return reply.code(400).send({ error: "name required" });
    const vp = validateMinPair(req.body?.startMin, req.body?.endMin);
    if (!vp.ok) return reply.code(400).send({ error: vp.error });
    const sortOrder =
      typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)
        ? req.body.sortOrder
        : 0;
    const row = await prisma.storeTimeWindow.create({
      data: {
        storeId: store.id,
        name,
        startMin: vp.startMin,
        endMin: vp.endMin,
        sortOrder,
      },
    });
    return row;
  });

  app.patch<{
    Params: { storeId: string; timeWindowId: string };
    Body: { name?: string; startMin?: number; endMin?: number; sortOrder?: number };
  }>("/stores/:storeId/time-windows/:timeWindowId", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const row = await prisma.storeTimeWindow.findFirst({
      where: { id: req.params.timeWindowId, storeId: req.params.storeId },
    });
    if (!row) return reply.code(404).send({ error: "time window not found" });
    const data: { name?: string; startMin?: number; endMin?: number; sortOrder?: number } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (req.body && "startMin" in req.body && "endMin" in req.body) {
      const vp = validateMinPair(req.body.startMin, req.body.endMin);
      if (!vp.ok) return reply.code(400).send({ error: vp.error });
      data.startMin = vp.startMin;
      data.endMin = vp.endMin;
    } else if (req.body && ("startMin" in req.body || "endMin" in req.body)) {
      return reply.code(400).send({ error: "startMin and endMin must be updated together" });
    }
    if (typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)) {
      data.sortOrder = req.body.sortOrder;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });
    return prisma.storeTimeWindow.update({ where: { id: row.id }, data });
  });

  app.delete<{ Params: { storeId: string; timeWindowId: string } }>(
    "/stores/:storeId/time-windows/:timeWindowId",
    async (req, reply) => {
      if (!assertManagerRole(reply, req.user)) return;
      const row = await prisma.storeTimeWindow.findFirst({
        where: { id: req.params.timeWindowId, storeId: req.params.storeId },
      });
      if (!row) return reply.code(404).send({ error: "time window not found" });
      await prisma.storeTimeWindow.delete({ where: { id: row.id } });
      return { ok: true };
    },
  );
}
