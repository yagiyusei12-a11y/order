import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyGuestDisplayKey } from "../lib/guest-display-auth.js";
import { loadSessionDisplaySummary } from "../lib/session-display-summary.js";

function keyFromRequest(req: FastifyRequest): string {
  const q = req.query as { key?: unknown };
  return typeof q.key === "string" ? q.key.trim() : "";
}

async function assertGuestDisplayAccess(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply,
): Promise<boolean> {
  const storeId = req.params.storeId;
  const key = keyFromRequest(req);
  if (!verifyGuestDisplayKey(storeId, key)) {
    reply.code(403).type("text/plain; charset=utf-8").send("invalid display key");
    return false;
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  });
  if (!store) {
    reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    return false;
  }
  return true;
}

export async function registerGuestDisplayApi(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { key?: string; sessionId?: string };
  }>("/guest-display/api/:storeId/session-summary", async (req, reply) => {
    if (!(await assertGuestDisplayAccess(req, reply))) return;
    const sessionId =
      typeof req.query.sessionId === "string" && req.query.sessionId.trim()
        ? req.query.sessionId.trim()
        : "";
    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId required" });
    }
    const summary = await loadSessionDisplaySummary(req.params.storeId, sessionId);
    if (!summary) return reply.code(404).send({ error: "session not found" });
    const store = await prisma.store.findUnique({
      where: { id: req.params.storeId },
      select: { name: true },
    });
    return {
      storeName: store?.name ?? "",
      ...summary,
    };
  });

  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/guest-display/api/:storeId/meta",
    async (req, reply) => {
      if (!(await assertGuestDisplayAccess(req, reply))) return;
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { name: true },
      });
      if (!store) return reply.code(404).send({ error: "store not found" });
      return { storeId: req.params.storeId, storeName: store.name };
    },
  );
}
