import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { isPlatformAdminEmail } from "../lib/platform-admin.js";
import { normalizeStaffEmail, parseStoreId, validatePasswordPlain } from "../lib/staff-credentials.js";

async function verifyPlatformAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await req.jwtVerify();
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  const sub = (req.user as { sub?: string }).sub;
  if (!sub) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  const row = await prisma.staffUser.findUnique({
    where: { id: sub },
    select: { email: true, storeId: true },
  });
  if (!row || !isPlatformAdminEmail(row.email)) {
    void reply.code(403).send({ error: "platform admin required" });
    return false;
  }
  const u = req.user as { storeId?: string; email?: string };
  u.storeId = row.storeId;
  u.email = row.email;
  return true;
}

/** プラットフォーム管理者向け：店舗一覧・新規店舗追加（JWT 必須・店舗スコープ外） */
export async function registerPlatformStores(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", verifyPlatformAdmin);

  app.get("/platform/stores", async (_req, reply) => {
    const rows = await prisma.store.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { staffUsers: true } },
      },
    });
    return {
      stores: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        staffCount: r._count.staffUsers,
      })),
    };
  });

  app.post<{
    Body: {
      storeId?: string;
      storeName?: string;
      email?: string;
      password?: string;
    };
  }>("/platform/stores", async (req, reply) => {
    const storeId = parseStoreId(req.body?.storeId ?? "");
    if (!storeId) {
      return reply
        .code(400)
        .send({ error: "店舗IDは2〜64文字の英小文字・数字・-_のみ（login / setup は使えません）" });
    }
    const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim() : "";
    if (!storeName) {
      return reply.code(400).send({ error: "店舗名を入力してください" });
    }

    const email = normalizeStaffEmail(req.body?.email ?? "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: "有効なメールアドレスを入力してください" });
    }
    const password = req.body?.password ?? "";
    const pwErr = validatePasswordPlain(password);
    if (pwErr) return reply.code(400).send({ error: pwErr });

    const existing = await prisma.store.findUnique({ where: { id: storeId } });
    if (existing) {
      return reply.code(409).send({ error: "この店舗IDは既に使われています" });
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

    const actorStoreId = (req.user as { storeId?: string }).storeId;
    const actorSub = (req.user as { sub?: string }).sub;
    if (actorStoreId && actorSub) {
      await appendStaffAuditFromRequest(req, actorStoreId, actorSub, "platform_store_create", {
        newStoreId: storeId,
        newStoreName: storeName,
        managerEmail: email,
      }).catch(() => {});
    }

    return { ok: true, storeId, name: storeName, email };
  });
}
