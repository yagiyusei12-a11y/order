// One-off: node scripts/check-smtp-config.js [storeId]
import { PrismaClient } from "@prisma/client";

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
  const st = store?.settings && typeof store.settings === "object" ? store.settings : {};
  console.log(
    JSON.stringify(
      {
        storeId,
        env,
        store: {
          smtpOutboundEnabled: Boolean(st.smtpOutboundEnabled),
          smtpHost: st.smtpHost ? "set" : "empty",
          mailFrom: st.mailFrom ? "set" : "empty",
          smtpUser: st.smtpUser ? "set" : "empty",
          smtpPassConfigured: Boolean(st.smtpPass && String(st.smtpPass).length),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
