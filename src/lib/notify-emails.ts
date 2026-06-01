import { isMailConfigured, sendMailSafe } from "./mail.js";
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

export function netReserveGuestEmailFromData(data: Record<string, unknown>): string {
  const emailRaw = typeof data.email === "string" ? data.email.trim() : "";
  return emailRaw.length > 0 && EMAIL_RE.test(emailRaw) ? emailRaw : "";
}

export type NetReserveCancelNotifyInput = {
  storeId: string;
  storeName: string;
  resKey: string;
  date: string;
  time: string;
  name: string;
  num: number;
  note: string;
  seatType: string;
  storedPhone: string;
  emailForMail: string;
  receptionConfig: Record<string, unknown>;
  storeSettings: StoreSettingsShape;
  receptionUrl: string;
};

/** ネット予約キャンセル時: お客様（メール登録時）＋店舗向け通知メール */
export async function sendNetReserveCancelNotifications(
  input: NetReserveCancelNotifyInput,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  const staffNotifyTo = netReserveStaffNotifyEmails(input.receptionConfig);
  const stSet = input.storeSettings;

  if (!isMailConfigured(stSet)) {
    if (input.emailForMail || staffNotifyTo.length > 0) {
      log?.warn({ storeId: input.storeId }, "net reserve cancel mail skipped: SMTP not configured");
    }
    return;
  }

  const guestLines = [
    `${input.storeName} のネット予約をキャンセルしました。`,
    "",
    `予約番号: ${input.resKey}`,
    `日付: ${input.date}`,
    `時間: ${input.time}`,
    `お名前: ${input.name}`,
    `人数: ${input.num}名`,
    ...(input.note ? [`備考: ${input.note}`] : []),
    ...(input.seatType ? [`席種別: ${input.seatType}`] : []),
    "",
    "※このメールは送信専用です。",
  ];
  const guestSubject = `【予約キャンセル】${input.storeName} ${input.date} ${input.time}`;

  const staffLines = [
    `【ネット予約キャンセル】${input.storeName}`,
    "",
    `予約番号: ${input.resKey}`,
    `日付: ${input.date}`,
    `時間: ${input.time}`,
    `お名前: ${input.name}`,
    `電話: ${input.storedPhone}`,
    `人数: ${input.num}名`,
    ...(input.seatType ? [`席種別: ${input.seatType}`] : []),
    ...(input.note ? [`備考: ${input.note}`] : []),
    ...(input.emailForMail ? [`メール: ${input.emailForMail}`] : []),
    "",
    `受付画面: ${input.receptionUrl}`,
  ];
  const staffSubject = `【予約キャンセル】${input.date} ${input.time} ${input.name}様`;

  if (input.emailForMail) {
    await sendMailSafe(
      { to: input.emailForMail, subject: guestSubject, text: guestLines.join("\n") },
      { storeSettings: stSet },
    );
  }

  if (staffNotifyTo.length > 0) {
    await sendNotifyEmailList(
      staffNotifyTo,
      { subject: staffSubject, text: staffLines.join("\n") },
      { storeSettings: stSet },
    );
  }
}
