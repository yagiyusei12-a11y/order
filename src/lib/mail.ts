import nodemailer from "nodemailer";
import type { StoreSettingsShape } from "./store-settings.js";

type ResolvedOutbound = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | undefined;
  from: string;
};

function resolveOutboundFromStore(st: StoreSettingsShape): ResolvedOutbound | null {
  if (!st.smtpOutboundEnabled) return null;
  const host = st.smtpHost.trim();
  const from = st.mailFrom.trim();
  if (!host || !from) return null;
  const port =
    typeof st.smtpPort === "number" && Number.isFinite(st.smtpPort)
      ? Math.min(65535, Math.max(1, Math.round(st.smtpPort)))
      : 587;
  const user = st.smtpUser.trim();
  const pass = st.smtpPass;
  return {
    host,
    port,
    secure: st.smtpSecure === true,
    auth: user && pass ? { user, pass } : undefined,
    from,
  };
}

function resolveOutboundFromEnv(): ResolvedOutbound | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  return {
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    from,
  };
}

/** 店舗設定を優先し、無ければ環境変数（どちらも無効なら null） */
export function resolveMailOutbound(st?: StoreSettingsShape): ResolvedOutbound | null {
  if (st) {
    const fromStore = resolveOutboundFromStore(st);
    if (fromStore) return fromStore;
  }
  return resolveOutboundFromEnv();
}

export function isMailConfigured(st?: StoreSettingsShape): boolean {
  return resolveMailOutbound(st) !== null;
}

/**
 * SMTP 未設定時は no-op。送信失敗は呼び出し側でログする。
 * `storeSettings` があれば店舗 SMTP を優先し、無効時は環境変数へフォールバックする。
 */
export async function sendMailSafe(
  opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  },
  ctx?: { storeSettings?: StoreSettingsShape },
): Promise<void> {
  const out = resolveMailOutbound(ctx?.storeSettings);
  if (!out) return;
  const transporter = nodemailer.createTransport({
    host: out.host,
    port: out.port,
    secure: out.secure,
    auth: out.auth,
  });
  await transporter.sendMail({
    from: out.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, "<br>"),
  });
}
