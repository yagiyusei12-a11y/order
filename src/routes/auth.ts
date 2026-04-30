import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { STAFF_JWT_COOKIE_NAME, cookieSecureDefault } from "../config.js";
import { prisma } from "../db.js";

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: Number(process.env.AUTH_LOGIN_MAX_PER_MINUTE ?? 30),
      timeWindow: "1 minute",
    });
    scope.post<{
      Body: { email?: string; password?: string; storeId?: string };
    }>("/auth/login", async (req, reply) => {
      const email = req.body?.email?.trim().toLowerCase();
      const password = req.body?.password ?? "";
      const storeId = req.body?.storeId?.trim();
      if (!email || !password || !storeId) {
        return reply.code(400).send({ error: "email, password, and storeId required" });
      }

      const user = await prisma.staffUser.findUnique({
        where: { storeId_email: { storeId, email } },
      });
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return reply.code(401).send({ error: "invalid credentials" });
      }

      const token = await reply.jwtSign(
        { sub: user.id, storeId: user.storeId, email: user.email },
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
    return { user: req.user };
  });
}

