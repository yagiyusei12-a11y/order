import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { authenticate } from "../auth/pre.js";
import { userEffectivePermissionList } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { hashToken, randomRefreshToken } from "../lib/tokens.js";

const REFRESH_DAYS = 30;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { tenantName?: string; slug?: string; email?: string; password?: string; displayName?: string };
  }>("/auth/register", async (req, reply) => {
    const tenantName = String(req.body?.tenantName || "").trim();
    const slug = String(req.body?.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = String(req.body?.displayName || "").trim() || null;
    if (!tenantName || !slug || !email || !password) {
      return reply.code(400).send({ error: "tenantName, slug, email, password required" });
    }
    if (password.length < 8) return reply.code(400).send({ error: "password min 8 chars" });

    const exists = await prisma.tenant.findUnique({ where: { slug } });
    if (exists) return reply.code(409).send({ error: "slug already used" });

    const passwordHash = await bcrypt.hash(password, 10);
    const tenant = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: tenantName, slug, timezone: "Asia/Tokyo" },
      });
      await tx.tenantSettings.create({
        data: { tenantId: t.id, businessDayRollHour: 4, featureFlags: {}, customJson: {} },
      });
      await tx.subscription.create({
        data: { tenantId: t.id, planTier: "FREE", validFrom: new Date() },
      });
      const ownerRole = await tx.role.create({
        data: { tenantId: t.id, name: "owner", permissions: ["*"] },
      });
      const user = await tx.user.create({
        data: { tenantId: t.id, email, passwordHash, displayName },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: ownerRole.id } });
      return t;
    });

    const user = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, email } });
    const tokens = await issueTokens(reply, user.id, user.tenantId, user.email);
    return { tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, ...tokens };
  });

  app.post<{ Body: { email?: string; password?: string; slug?: string } }>("/auth/login", async (req, reply) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const slug = String(req.body?.slug || "").trim().toLowerCase();
    if (!email || !password || !slug) return reply.code(400).send({ error: "email, password, slug required" });
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return reply.code(401).send({ error: "invalid credentials" });
    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    return issueTokens(reply, user.id, user.tenantId, user.email);
  });

  app.post<{ Body: { refreshToken?: string } }>("/auth/refresh", async (req, reply) => {
    const raw = String(req.body?.refreshToken || "");
    if (!raw) return reply.code(400).send({ error: "refreshToken required" });
    const tokenHash = hashToken(raw);
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.expiresAt < new Date()) return reply.code(401).send({ error: "invalid refresh" });
    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) return reply.code(401).send({ error: "invalid refresh" });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return issueTokens(reply, user.id, user.tenantId, user.email);
  });

  app.get("/me", { preHandler: [authenticate] }, async (req) => {
    const u = req.user as { sub: string; tenantId: string; email: string };
    const user = await prisma.user.findUnique({
      where: { id: u.sub },
      include: { roles: { include: { role: true } }, tenant: { select: { id: true, name: true, slug: true } } },
    });
    const permissions = user ? await userEffectivePermissionList(user.id, user.tenantId) : [];
    return {
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            tenant: user.tenant,
            roles: user.roles.map((r) => r.role.name),
            permissions,
          }
        : null,
    };
  });
}

async function issueTokens(
  reply: FastifyReply,
  userId: string,
  tenantId: string,
  email: string,
): Promise<{ accessToken: string; refreshToken: string; expiresInSec: number }> {
  const accessToken = await reply.jwtSign({ sub: userId, tenantId, email }, { expiresIn: "15m" });
  const raw = randomRefreshToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400000);
  await prisma.refreshToken.create({
    data: { userId, tenantId, tokenHash, expiresAt },
  });
  return { accessToken, refreshToken: raw, expiresInSec: 15 * 60 };
}
