import { prisma } from "../db.js";

export type GuestBillingContext = {
  billingSessionId: string;
  orderSourceTableId: string | null;
};

/**
 * ゲスト注文・メニューの請求先セッション。
 * - open: 自分自身
 * - merged: 親（open）セッション。注文は sourceTableId に子卓を付ける
 */
export async function resolveGuestBillingContext(session: {
  id: string;
  status: string;
  storeId: string;
  tableId: string;
  mergedIntoSessionId: string | null;
}): Promise<
  | { ok: true; ctx: GuestBillingContext }
  | { ok: false; status: 404 | 409; body: { error: string; message?: string } }
> {
  if (session.status === "open") {
    return { ok: true, ctx: { billingSessionId: session.id, orderSourceTableId: null } };
  }
  if (session.status === "merged" && session.mergedIntoSessionId) {
    const parent = await prisma.diningSession.findFirst({
      where: { id: session.mergedIntoSessionId, storeId: session.storeId, status: "open" },
      select: { id: true },
    });
    if (!parent) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "merge_parent_unavailable",
          message: "代表卓のセッションが利用中ではありません。スタッフにお声がけください。",
        },
      };
    }
    return {
      ok: true,
      ctx: { billingSessionId: parent.id, orderSourceTableId: session.tableId },
    };
  }
  return { ok: false, status: 404, body: { error: "session not found or closed" } };
}
