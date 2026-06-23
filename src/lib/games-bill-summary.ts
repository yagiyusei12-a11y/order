import { prisma } from "../db.js";
import { resolveGuestBillingContext } from "./guest-billing-context.js";
import { liveSessionSuggestedTotal } from "./session-live-total.js";
import { mergeStoreSettings } from "./store-settings.js";

export async function loadGamesHubBillSummary(
  storeId: string,
  guestToken: string,
): Promise<
  | {
      ok: true;
      tableName: string;
      billingSessionId: string;
      guestCount: number;
      totalYen: number | null;
      totalAvailable: boolean;
    }
  | { ok: false; error: string; status: number }
> {
  const session = await prisma.diningSession.findUnique({
    where: { guestToken },
    select: {
      id: true,
      status: true,
      storeId: true,
      tableId: true,
      mergedIntoSessionId: true,
      table: { select: { name: true } },
    },
  });
  if (!session || session.storeId !== storeId) {
    return { ok: false, error: "session not found", status: 404 };
  }
  if (session.status !== "open") {
    return { ok: false, error: "session closed", status: 404 };
  }
  const billing = await resolveGuestBillingContext(session);
  if (!billing.ok) {
    return { ok: false, error: billing.body.error || "billing unavailable", status: billing.status };
  }

  const billingSessionRow = await prisma.diningSession.findUnique({
    where: { id: billing.ctx.billingSessionId },
    select: {
      guestCount: true,
      courseId: true,
      childCount: true,
      coursePriceTier: {
        select: { durationMinutes: true, pricePerPerson: true, childPricePerPerson: true },
      },
      bill: { select: { status: true, discountJson: true } },
    },
  });
  if (!billingSessionRow) {
    return { ok: false, error: "session not found", status: 404 };
  }

  const storeRow = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const st = mergeStoreSettings(storeRow?.settings);

  let totalYen: number | null = null;
  if (st.guestShowMenuPrices) {
    const orders = await prisma.salesOrder.findMany({
      where: { sessionId: billing.ctx.billingSessionId },
      include: { lines: true },
    });
    totalYen = liveSessionSuggestedTotal({
      courseId: billingSessionRow.courseId,
      guestCount: billingSessionRow.guestCount,
      childCount: billingSessionRow.childCount,
      coursePriceTier: billingSessionRow.coursePriceTier,
      orders,
      bill: billingSessionRow.bill,
    });
  }

  return {
    ok: true,
    tableName: session.table?.name ?? "",
    billingSessionId: billing.ctx.billingSessionId,
    guestCount: Math.max(1, billingSessionRow.guestCount),
    totalYen,
    totalAvailable: st.guestShowMenuPrices,
  };
}
