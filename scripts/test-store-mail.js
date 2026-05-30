// node scripts/test-store-mail.js [storeId] [toEmail]
import { PrismaClient } from "@prisma/client";
import { mergeStoreSettings } from "../dist/lib/store-settings.js";
import { isMailConfigured, sendMailSafe } from "../dist/lib/mail.js";

const storeId = process.argv[2] || "harunoyukoto";
const to = process.argv[3];
const prisma = new PrismaClient();

try {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, settings: true },
  });
  if (!store) throw new Error("store not found");
  const st = mergeStoreSettings(store.settings);
  console.log("mailConfigured:", isMailConfigured(st));
  if (!to) {
    console.log("usage: node scripts/test-store-mail.js <storeId> <toEmail>");
    process.exit(0);
  }
  await sendMailSafe(
    {
      to,
      subject: `【${store.name}】メール送信テスト`,
      text: "これは order-app からの SMTP テストです。",
    },
    { storeSettings: st },
  );
  console.log("sent ok to", to);
} catch (e) {
  console.error("send failed:", e instanceof Error ? e.message : e);
  if (e && typeof e === "object" && "response" in e) console.error(e.response);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
