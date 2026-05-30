import { sendMailSafe } from "./mail.js";
import type { StoreSettingsShape } from "./store-settings.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** receptionConfig.netReserveNotifyEmails 等: 配列または改行・カンマ区切り文字列 */
export function parseNotifyEmailList(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) parts.push(String(x ?? ""));
  } else if (typeof raw === "string") {
    parts.push(...raw.split(/[\n,，;；]+/));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const e = p.trim();
    if (!e || !EMAIL_RE.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function netReserveStaffNotifyEmails(c: Record<string, unknown>): string[] {
  const fromConfig = parseNotifyEmailList(c.netReserveNotifyEmails);
  if (fromConfig.length > 0) return fromConfig;
  const env = process.env.NET_RESERVE_NOTIFY_EMAIL?.trim();
  if (env) return parseNotifyEmailList(env);
  return [];
}

/** ネットテイクアウトの店舗通知。未設定なら netReserveNotifyEmails / NET_RESERVE_NOTIFY_EMAIL にフォールバック */
export function takeoutNetStaffNotifyEmails(c: Record<string, unknown>): string[] {
  const fromConfig = parseNotifyEmailList(c.takeoutNetNotifyEmails);
  if (fromConfig.length > 0) return fromConfig;
  const env = process.env.TAKEOUT_NET_NOTIFY_EMAIL?.trim();
  if (env) return parseNotifyEmailList(env);
  return netReserveStaffNotifyEmails(c);
}

export async function sendNotifyEmailList(
  recipients: string[],
  mail: { subject: string; text: string },
  ctx?: { storeSettings?: StoreSettingsShape },
): Promise<void> {
  if (!recipients.length) return;
  for (const to of recipients) {
    await sendMailSafe({ to, subject: mail.subject, text: mail.text }, ctx);
  }
}
