import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { STAFF_JWT_COOKIE_NAME, cookieSecureDefault } from "../config.js";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest, maskEmailForAudit } from "../lib/staff-audit.js";
import { normalizeStaffEmail, parseStoreId, validatePasswordPlain } from "../lib/staff-credentials.js";

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.get("/auth/bootstrap-status", async () => {
    const disabled = process.env.BOOTSTRAP_DISABLED === "1";
    if (disabled) return { open: false, reason: "disabled" as const };
    const count = await prisma.staffUser.count();
    return { open: count === 0, reason: count === 0 ? ("empty" as const) : ("staff_exist" as const) };
  });

  app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: Number(process.env.AUTH_LOGIN_MAX_PER_MINUTE ?? 30),
      timeWindow: "1 minute",
    });
    scope.post<{
      Body: {
        storeId?: string;
        storeName?: string;
        email?: string;
        password?: string;
      };
    }>("/auth/bootstrap", async (req, reply) => {
      if (process.env.BOOTSTRAP_DISABLED === "1") {
        return reply.code(403).send({ error: "bootstrap disabled" });
      }
      const existingStaff = await prisma.staffUser.count();
      if (existingStaff > 0) {
        return reply.code(403).send({ error: "already initialized" });
      }

      const storeId = parseStoreId(req.body?.storeId ?? "");
      if (!storeId) {
        return reply
          .code(400)
          .send({ error: "店舗IDは2〜64文字の英小文字・数字・-_のみ（login / setup は使えません）" });
      }
      const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim() : "";

      const email = normalizeStaffEmail(req.body?.email ?? "");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ error: "有効なメールアドレスを入力してください" });
      }
      const password = req.body?.password ?? "";
      const pwErr = validatePasswordPlain(password);
      if (pwErr) return reply.code(400).send({ error: pwErr });

      const storeRow = await prisma.store.findUnique({ where: { id: storeId } });
      if (!storeRow && !storeName) {
        return reply.code(400).send({ error: "店舗名を入力してください（新規店舗のとき必須）" });
      }

      if (storeRow) {
        const dupe = await prisma.staffUser.findUnique({
          where: { storeId_email: { storeId, email } },
        });
        if (dupe) return reply.code(409).send({ error: "このメールは既に登録されています" });
        await prisma.staffUser.create({
          data: {
            storeId,
            email,
            passwordHash: bcrypt.hashSync(password, 10),
            role: "manager",
          },
        });
        return { ok: true, storeId, email, createdStore: false };
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.store.create({
            data: { id: storeId, name: storeName, settings: {} },
          });
          await tx.staffUser.create({
            data: {
              storeId,
              email,
              passwordHash: bcrypt.hashSync(password, 10),
              role: "manager",
            },
          });
        });
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "P2002") {
          return reply.code(409).send({ error: "この店舗IDは既に使われています" });
        }
        throw e;
      }

      return { ok: true, storeId, email, createdStore: true };
    });

    scope.post<{
      Body: { email?: string; password?: string; storeId?: string };
    }>("/auth/login", async (req, reply) => {
      const email = normalizeStaffEmail(req.body?.email ?? "");
      const password = req.body?.password ?? "";
      const storeId = req.body?.storeId?.trim().toLowerCase() ?? "";
      if (!email || !password || !storeId) {
        return reply.code(400).send({ error: "email, password, and storeId required" });
      }

      const user = await prisma.staffUser.findUnique({
        where: { storeId_email: { storeId, email } },
      });
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        const storeExists = await prisma.store.findUnique({
          where: { id: storeId },
          select: { id: true },
        });
        if (storeExists) {
          await appendStaffAuditFromRequest(req, storeId, null, "login_failed", {
            emailHint: maskEmailForAudit(email),
          }).catch(() => {});
        }
        return reply.code(401).send({ error: "invalid credentials" });
      }

      const roleJwt = user.role === "manager" ? "manager" : "staff";
      const token = await reply.jwtSign(
        { sub: user.id, storeId: user.storeId, email: user.email, role: roleJwt },
        { expiresIn: process.env.JWT_EXPIRES_IN ?? "12h" }
      );

      reply.setCookie(STAFF_JWT_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        secure: cookieSecureDefault(),
        sameSite: "strict",
        maxAge: 60 * 60 * 12,
      });

      return { ok: true, storeId: user.storeId, email: user.email };
    });
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(STAFF_JWT_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      secure: cookieSecureDefault(),
      sameSite: "strict",
    });
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const sub = (req.user as { sub?: string }).sub;
    if (!sub) return reply.code(401).send({ error: "unauthorized" });
    const row = await prisma.staffUser.findUnique({
      where: { id: sub },
      select: { id: true, storeId: true, email: true, role: true },
    });
    if (!row) return reply.code(401).send({ error: "unauthorized" });
    return {
      user: {
        sub: row.id,
        storeId: row.storeId,
        email: row.email,
        role: row.role === "manager" ? "manager" : "staff",
      },
    };
  });
}

