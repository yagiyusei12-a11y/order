// One-off: node scripts/check-smtp-config.js [storeId]
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { mergeStoreSettings } from "../dist/lib/store-settings.js";
import { resolveMailOutbound } from "../dist/lib/mail.js";

const storeId = process.argv[2] || "harunoyukoto";
const prisma = new PrismaClient();

try {
  const env = {
    SMTP_HOST: process.env.SMTP_HOST ? "set" : "empty",
    MAIL_FROM: process.env.MAIL_FROM ? "set" : "empty",
    SMTP_USER: process.env.SMTP_USER ? "set" : "empty",
    SMTP_PASS: process.env.SMTP_PASS ? "set" : "empty",
  };
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const st = mergeStoreSettings(store?.settings);
  const out = resolveMailOutbound(st);
  let verify = null;
  if (out) {
    try {
      const tx = nodemailer.createTransport({
        host: out.host,
        port: out.port,
        secure: out.secure,
        auth: out.auth,
      });
      await tx.verify();
      verify = "ok";
    } catch (e) {
      verify = e instanceof Error ? e.message : String(e);
    }
  } else {
    verify = "no outbound config";
  }
  console.log(
    JSON.stringify(
      {
        storeId,
        env,
        store: {
          smtpOutboundEnabled: Boolean(st.smtpOutboundEnabled),
          smtpHost: st.smtpHost ? "set" : "empty",
          smtpPort: st.smtpPort,
          smtpSecure: st.smtpSecure,
          mailFrom: st.mailFrom ? "set" : "empty",
          smtpUser: st.smtpUser ? "set" : "empty",
          smtpPassConfigured: Boolean(st.smtpPass && String(st.smtpPass).length),
        },
        verify,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
