import nodemailer from "nodemailer";

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

/**
 * SMTP 未設定時は no-op。送信失敗は呼び出し側でログする。
 */
export async function sendMailSafe(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!isMailConfigured()) return;
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, "<br>"),
  });
}
