import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { userHasPermission } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const allowed = await userHasPermission(u.sub, tid, "rbac.manage");
    if (!allowed) return reply.code(403).send({ error: "forbidden" });
    const rows = await prisma.user.findMany({
      where: { tenantId: tid },
      orderBy: { email: "asc" },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
    return {
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        roles: row.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
      })),
    };
  });
}
