import { paymentAuditKeyForStore } from "./payment-audit-auth.js";

export { staffRequestOrigin } from "./guest-display-url.js";

export function paymentAuditPublicUrl(origin: string, storeId: string): string {
  const base = origin.replace(/\/$/, "");
  const key = paymentAuditKeyForStore(storeId);
  return `${base}/payment-audit/${encodeURIComponent(storeId)}?key=${encodeURIComponent(key)}`;
}
