import type { Prisma } from "@prisma/client";
import type { StoreSettingsShape } from "./store-settings.js";

function methodCodesForCashDrawer(settings: StoreSettingsShape): Set<string> {
  const arr = settings.cashDrawerAutoMethodCodes;
  const codes = arr.length ? arr : ["cash"];
  return new Set(codes);
}

export function cashDrawerAutoTargetsPayment(settings: StoreSettingsShape, methodCode: string): boolean {
  if (!settings.cashDrawerAutoFromPayments) return false;
  return methodCodesForCashDrawer(settings).has(methodCode);
}

type PaymentLike = { id: string; methodCode: string; amount: number };

export async function appendSaleCashEntryIfEnabled(
  tx: Prisma.TransactionClient,
  settings: StoreSettingsShape,
  storeId: string,
  staffUserId: string | null,
  payment: PaymentLike,
): Promise<void> {
  if (!cashDrawerAutoTargetsPayment(settings, payment.methodCode)) return;

  const dup = await tx.cashDrawerEntry.findFirst({
    where: { storeId, sourcePaymentId: payment.id },
    select: { id: true },
  });
  if (dup) return;

  const last = await tx.cashDrawerEntry.findFirst({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterYen: true },
  });
  const balance = last?.balanceAfterYen ?? 0;
  const newBal = balance + payment.amount;

  await tx.cashDrawerEntry.create({
    data: {
      storeId,
      staffUserId,
      kind: "sale_cash",
      amountDeltaYen: payment.amount,
      balanceAfterYen: newBal,
      countedYen: null,
      note: null,
      sourcePaymentId: payment.id,
    },
  });
}

export async function appendVoidSaleCashEntryIfEnabled(
  tx: Prisma.TransactionClient,
  settings: StoreSettingsShape,
  storeId: string,
  staffUserId: string | null,
  payment: PaymentLike,
  reasonLabel?: string | null,
): Promise<void> {
  if (!cashDrawerAutoTargetsPayment(settings, payment.methodCode)) return;

  const voidKey = `void:${payment.id}`;
  const voidDup = await tx.cashDrawerEntry.findFirst({
    where: { storeId, sourcePaymentId: voidKey },
    select: { id: true },
  });
  if (voidDup) return;

  const saleRow = await tx.cashDrawerEntry.findFirst({
    where: { storeId, sourcePaymentId: payment.id },
    select: { id: true },
  });
  if (!saleRow) return;

  const last = await tx.cashDrawerEntry.findFirst({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfterYen: true },
  });
  const balance = last?.balanceAfterYen ?? 0;
  const delta = -payment.amount;
  const newBal = balance + delta;

  await tx.cashDrawerEntry.create({
    data: {
      storeId,
      staffUserId,
      kind: "sale_cash_void",
      amountDeltaYen: delta,
      balanceAfterYen: newBal,
      countedYen: null,
      note: reasonLabel ? reasonLabel.trim().slice(0, 2000) || null : null,
      sourcePaymentId: voidKey,
    },
  });
}
