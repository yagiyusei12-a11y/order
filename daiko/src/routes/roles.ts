import type { FastifyInstance, FastifyReply } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { writeAuditEvent } from "../lib/audit.js";
import { userHasPermission } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

async function requireRbacManage(
  userId: string,
  tenantId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const ok = await userHasPermission(userId, tenantId, "rbac.manage");
  if (!ok) reply.code(403).send({ error: "forbidden" });
  return ok;
}

export async function registerRoleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/roles", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const roles = await prisma.role.findMany({
      where: { tenantId: tid },
      orderBy: { name: "asc" },
    });
    return { roles };
  });

  app.post<{
    Body: { name?: string; permissions?: unknown };
  }>("/roles", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    if (!(await requireRbacManage(u.sub, tid, reply))) return;
    const name = String(req.body?.name || "").trim();
    const perms = req.body?.permissions;
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!Array.isArray(perms) || !perms.every((p) => typeof p === "string")) {
      return reply.code(400).send({ error: "permissions must be string[]" });
    }
    try {
      const role = await prisma.role.create({
        data: { tenantId: tid, name, permissions: perms },
      });
      await writeAuditEvent({
        tenantId: tid,
        actorUserId: u.sub,
        action: "role.create",
        entityType: "Role",
        entityId: role.id,
        payload: { name, permissions: perms },
      });
      return role;
    } catch {
      return reply.code(409).send({ error: "role name exists" });
    }
  });

  app.delete<{ Params: { id: string } }>("/roles/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    if (!(await requireRbacManage(u.sub, tid, reply))) return;
    const role = await prisma.role.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!role) return reply.code(404).send({ error: "not found" });
    if (role.name === "owner") return reply.code(400).send({ error: "cannot delete owner role" });
    await prisma.userRole.deleteMany({ where: { roleId: role.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await writeAuditEvent({
      tenantId: tid,
      actorUserId: u.sub,
      action: "role.delete",
      entityType: "Role",
      entityId: role.id,
      payload: { name: role.name },
    });
    return { ok: true };
  });

  app.post<{
    Params: { userId: string };
    Body: { roleId?: string };
  }>("/users/:userId/roles", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    if (!(await requireRbacManage(u.sub, tid, reply))) return;
    const targetUserId = req.params.userId;
    const roleId = String(req.body?.roleId || "");
    if (!roleId) return reply.code(400).send({ error: "roleId required" });
    const target = await prisma.user.findFirst({ where: { id: targetUserId, tenantId: tid } });
    if (!target) return reply.code(404).send({ error: "user not found" });
    const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: tid } });
    if (!role) return reply.code(404).send({ error: "role not found" });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: targetUserId, roleId } },
      create: { userId: targetUserId, roleId },
      update: {},
    });
    await writeAuditEvent({
      tenantId: tid,
      actorUserId: u.sub,
      action: "userRole.assign",
      entityType: "UserRole",
      entityId: `${targetUserId}:${roleId}`,
      payload: { userId: targetUserId, roleId, roleName: role.name },
    });
    return { ok: true };
  });

  app.delete<{ Params: { userId: string; roleId: string } }>(
    "/users/:userId/roles/:roleId",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const u = jwtUser(req);
      if (!(await requireRbacManage(u.sub, tid, reply))) return;
      const { userId: targetUserId, roleId } = req.params;
      const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: tid } });
      if (!role) return reply.code(404).send({ error: "role not found" });
      if (role.name === "owner") return reply.code(400).send({ error: "cannot remove owner role assignment here" });
      await prisma.userRole.deleteMany({ where: { userId: targetUserId, roleId } });
      await writeAuditEvent({
        tenantId: tid,
        actorUserId: u.sub,
        action: "userRole.remove",
        entityType: "UserRole",
        entityId: `${targetUserId}:${roleId}`,
        payload: { userId: targetUserId, roleId },
      });
      return { ok: true };
    },
  );
}
