import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { normalizeStaffEmail, validatePasswordPlain } from "../lib/staff-credentials.js";
import { assertManagerRole } from "../lib/staff-role.js";
import { staffFooterOrderGateState } from "../lib/store-order-gate.js";
import { mergeStoreSettings } from "../lib/store-settings.js";

function staffSubFromReq(req: { user?: unknown }): string | null {
  const u = req.user as { sub?: string } | undefined;
  return u?.sub ?? null;
}

/** 英小文字・数字・アンダースコアのみ（決済記録の methodCode に保存されるため変更しにくい形式に正規化） */
function normalizePaymentMethodCode(raw: string): string | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!s.length || s.length > 64) return null;
  if (!/^[a-z0-9_]+$/.test(s)) return null;
  return s;
}

export async function registerStoreSettings(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/settings", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const settings = mergeStoreSettings(store.settings);
    return {
      store: { id: store.id, name: store.name, settings },
    };
  });

  /** スタッフフッター（営業状態・手動停止の表示用） */
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/order-footer", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st = mergeStoreSettings(store.settings);
    const foot = staffFooterOrderGateState(st, new Date());
    return {
      variant: foot.variant,
      labelJa: foot.labelJa,
      ordersPausedManually: st.ordersPausedManually,
    };
  });

  app.patch<{
    Params: { storeId: string };
    Body: { name?: string; settings?: Record<string, unknown> };
  }>("/stores/:storeId/settings", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;

    const data: { name?: string; settings?: object } = {};
    if (typeof req.body?.name === "string") {
      const n = req.body.name.trim();
      if (!n) return reply.code(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if (req.body?.settings !== undefined) {
      if (!req.body.settings || typeof req.body.settings !== "object" || Array.isArray(req.body.settings)) {
        return reply.code(400).send({ error: "settings must be an object" });
      }
      const cur = mergeStoreSettings(store.settings);
      const next = mergeStoreSettings({ ...cur, ...req.body.settings });
      data.settings = next;
    }

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.store.update({
      where: { id: store.id },
      data,
    });
    await appendStaffAuditFromRequest(req, store.id, staffSubFromReq(req), "store_settings_patch", {
      updatedFields: Object.keys(data),
    }).catch(() => {});
    return {
      store: {
        id: updated.id,
        name: updated.name,
        settings: mergeStoreSettings(updated.settings),
      },
    };
  });

  /**
   * 注文停止フラグのみ更新（店長ロール不要・ログイン済みスタッフ全員）
   */
  app.patch<{
    Params: { storeId: string };
    Body: { ordersPausedManually?: unknown };
  }>("/stores/:storeId/order-pause", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const v = req.body?.ordersPausedManually;
    if (typeof v !== "boolean") {
      return reply.code(400).send({ error: "ordersPausedManually must be a boolean" });
    }
    const cur = mergeStoreSettings(store.settings);
    const next = mergeStoreSettings({ ...cur, ordersPausedManually: v });
    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { settings: next as object },
    });
    await appendStaffAuditFromRequest(req, store.id, staffSubFromReq(req), "order_pause_toggle", {
      ordersPausedManually: v,
    }).catch(() => {});
    return {
      store: {
        id: updated.id,
        name: updated.name,
        settings: mergeStoreSettings(updated.settings),
      },
    };
  });

  app.get<{ Params: { storeId: string } }>("/stores/:storeId/staff-users", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const staffUsers = await prisma.staffUser.findMany({
      where: { storeId: store.id },
      orderBy: { email: "asc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return { storeId: store.id, staffUsers };
  });

  app.post<{
    Params: { storeId: string };
    Body: { email?: string; password?: string; name?: string };
  }>("/stores/:storeId/staff-users", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;

    const email = normalizeStaffEmail(req.body?.email ?? "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: "有効なメールアドレスを入力してください" });
    }
    const password = req.body?.password ?? "";
    const pwErr = validatePasswordPlain(password);
    if (pwErr) return reply.code(400).send({ error: pwErr });

    const name =
      typeof req.body?.name === "string" && req.body.name.trim()
        ? req.body.name.trim()
        : null;

    try {
      const row = await prisma.staffUser.create({
        data: {
          storeId: store.id,
          email,
          passwordHash: bcrypt.hashSync(password, 10),
          name,
          role: "staff",
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
      await appendStaffAuditFromRequest(req, store.id, staffSubFromReq(req), "staff_user_created", {
        staffUserId: row.id,
        email: row.email,
      }).catch(() => {});
      return row;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === "P2002") {
        return reply.code(409).send({ error: "このメールはこの店舗に既に登録されています" });
      }
      throw e;
    }
  });

  app.patch<{
    Params: { storeId: string; staffUserId: string };
    Body: { role?: string; name?: string | null; password?: string };
  }>("/stores/:storeId/staff-users/:staffUserId", async (req, reply) => {
    const storeId = req.params.storeId;
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;

    const target = await prisma.staffUser.findFirst({
      where: { id: req.params.staffUserId, storeId },
    });
    if (!target) return reply.code(404).send({ error: "staff user not found" });

    const body = req.body ?? {};
    const data: { role?: string; name?: string | null; passwordHash?: string } = {};

    if (body.role !== undefined) {
      const r = body.role === "manager" ? "manager" : body.role === "staff" ? "staff" : null;
      if (!r) return reply.code(400).send({ error: "role must be staff or manager" });
      if (r === "staff" && target.role === "manager") {
        const mgrCount = await prisma.staffUser.count({ where: { storeId, role: "manager" } });
        if (mgrCount <= 1) {
          return reply.code(400).send({ error: "最後の店長権限は外せません" });
        }
      }
      data.role = r;
    }

    if (body.name !== undefined) {
      data.name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    }

    if (body.password !== undefined) {
      const pw = body.password ?? "";
      const pwErr = validatePasswordPlain(pw);
      if (pwErr) return reply.code(400).send({ error: pwErr });
      data.passwordHash = bcrypt.hashSync(pw, 10);
    }

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.staffUser.update({
      where: { id: target.id },
      data,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    await appendStaffAuditFromRequest(req, storeId, staffSubFromReq(req), "staff_user_updated", {
      staffUserId: updated.id,
      changed: Object.keys(data).filter((k) => k !== "passwordHash"),
    }).catch(() => {});
    return updated;
  });

  app.delete<{ Params: { storeId: string; staffUserId: string } }>(
    "/stores/:storeId/staff-users/:staffUserId",
    async (req, reply) => {
      const storeId = req.params.storeId;
      const actorId = staffSubFromReq(req);
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });
      if (!assertManagerRole(reply, req.user)) return;

      const target = await prisma.staffUser.findFirst({
        where: { id: req.params.staffUserId, storeId },
      });
      if (!target) return reply.code(404).send({ error: "staff user not found" });
      if (actorId && target.id === actorId) {
        return reply.code(400).send({ error: "自分自身は削除できません" });
      }
      if (target.role === "manager") {
        const mgrCount = await prisma.staffUser.count({ where: { storeId, role: "manager" } });
        if (mgrCount <= 1) return reply.code(400).send({ error: "最後の店長アカウントは削除できません" });
      }

      await prisma.staffUser.delete({ where: { id: target.id } });
      await appendStaffAuditFromRequest(req, storeId, actorId, "staff_user_deleted", {
        staffUserId: target.id,
        email: target.email,
      }).catch(() => {});
      return { ok: true };
    },
  );

  app.post<{
    Params: { storeId: string };
    Body: { code: string; labelJa: string; sortOrder?: number; enabled?: boolean };
  }>("/stores/:storeId/payment-methods", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;
    const code = normalizePaymentMethodCode(req.body?.code ?? "");
    if (!code) {
      return reply
        .code(400)
        .send({ error: "code must be 1-64 chars: lowercase letters, digits, underscores only" });
    }
    const labelJa = typeof req.body?.labelJa === "string" ? req.body.labelJa.trim() : "";
    if (!labelJa) return reply.code(400).send({ error: "labelJa required" });
    const sortOrder =
      typeof req.body?.sortOrder === "number" && Number.isInteger(req.body.sortOrder)
        ? req.body.sortOrder
        : 0;
    const enabled = req.body?.enabled === false ? false : true;

    const existingLink = await prisma.storePaymentMethod.findFirst({
      where: { storeId: store.id, definition: { code } },
    });
    if (existingLink) {
      return reply.code(409).send({ error: "this store already has a payment method with that code" });
    }

    let def = await prisma.paymentMethodDefinition.findUnique({ where: { code } });
    if (!def) {
      def = await prisma.paymentMethodDefinition.create({
        data: { code, labelJa, sortOrder: 0 },
      });
    }

    const row = await prisma.storePaymentMethod.create({
      data: {
        storeId: store.id,
        definitionId: def.id,
        sortOrder,
        enabled,
      },
      include: { definition: true },
    });

    await appendStaffAuditFromRequest(req, store.id, staffSubFromReq(req), "payment_method_created", {
      code: row.definition.code,
    }).catch(() => {});
    return {
      id: row.id,
      code: row.definition.code,
      labelJa: row.definition.labelJa,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
    };
  });

  app.patch<{
    Params: { storeId: string; storePaymentMethodId: string };
    Body: { enabled?: boolean; sortOrder?: number; labelJa?: string };
  }>("/stores/:storeId/payment-methods/:storePaymentMethodId", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const row = await prisma.storePaymentMethod.findFirst({
      where: { id: req.params.storePaymentMethodId, storeId: req.params.storeId },
      include: { definition: true },
    });
    if (!row) return reply.code(404).send({ error: "payment method row not found" });

    const data: { enabled?: boolean; sortOrder?: number } = {};
    if (typeof req.body?.enabled === "boolean") {
      data.enabled = req.body.enabled;
    }
    if (typeof req.body?.sortOrder === "number") {
      if (!Number.isInteger(req.body.sortOrder)) {
        return reply.code(400).send({ error: "sortOrder must be integer" });
      }
      data.sortOrder = req.body.sortOrder;
    }

    let labelJa = row.definition.labelJa;
    if (typeof req.body?.labelJa === "string") {
      const lj = req.body.labelJa.trim();
      if (!lj) return reply.code(400).send({ error: "labelJa cannot be empty" });
      await prisma.paymentMethodDefinition.update({
        where: { id: row.definition.id },
        data: { labelJa: lj },
      });
      labelJa = lj;
    }

    const hasLabelField = typeof req.body?.labelJa === "string";
    if (Object.keys(data).length === 0 && !hasLabelField) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    const updated =
      Object.keys(data).length > 0
        ? await prisma.storePaymentMethod.update({
            where: { id: row.id },
            data,
          })
        : row;

    await appendStaffAuditFromRequest(req, req.params.storeId, staffSubFromReq(req), "payment_method_updated", {
      storePaymentMethodId: row.id,
      code: row.definition.code,
    }).catch(() => {});
    return {
      id: updated.id,
      code: row.definition.code,
      labelJa,
      enabled: updated.enabled,
      sortOrder: updated.sortOrder,
    };
  });

  app.delete<{ Params: { storeId: string; storePaymentMethodId: string } }>(
    "/stores/:storeId/payment-methods/:storePaymentMethodId",
    async (req, reply) => {
      if (!assertManagerRole(reply, req.user)) return;
      const row = await prisma.storePaymentMethod.findFirst({
        where: { id: req.params.storePaymentMethodId, storeId: req.params.storeId },
        include: { definition: true },
      });
      if (!row) return reply.code(404).send({ error: "payment method row not found" });

      await prisma.storePaymentMethod.delete({ where: { id: row.id } });
      await appendStaffAuditFromRequest(req, req.params.storeId, staffSubFromReq(req), "payment_method_deleted", {
        code: row.definition.code,
      }).catch(() => {});

      const stillLinked = await prisma.storePaymentMethod.count({
        where: { definitionId: row.definitionId },
      });
      if (stillLinked === 0) {
        const payUses = await prisma.payment.count({
          where: { methodCode: row.definition.code },
        });
        if (payUses === 0) {
          await prisma.paymentMethodDefinition.delete({
            where: { id: row.definition.id },
          });
        }
      }

      return { ok: true };
    },
  );
}
