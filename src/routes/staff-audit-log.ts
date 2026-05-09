import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { assertManagerRole } from "../lib/staff-role.js";

export async function registerStaffAuditLogRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { take?: string };
  }>("/stores/:storeId/staff-audit-log", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const takeRaw = Number(req.query?.take);
    const take = Number.isFinite(takeRaw) ? Math.min(200, Math.max(1, Math.floor(takeRaw))) : 100;
    const rows = await prisma.staffAuditLog.findMany({
      where: { storeId: req.params.storeId },
      orderBy: { createdAt: "desc" },
      take,
      include: { actor: { select: { email: true, name: true } } },
    });
    return {
      storeId: req.params.storeId,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: r.payload,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
        actor: r.actor ? { email: r.actor.email, name: r.actor.name } : null,
      })),
    };
  });
}
