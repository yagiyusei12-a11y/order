import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_METHODS: { code: string; labelJa: string; sortOrder: number }[] = [
  { code: "cash", labelJa: "現金", sortOrder: 10 },
  { code: "credit_card", labelJa: "クレジット", sortOrder: 20 },
  { code: "qr_paypay", labelJa: "PayPay", sortOrder: 30 },
  { code: "qr_linepay", labelJa: "LINE Pay", sortOrder: 40 },
  { code: "emoney_transit", labelJa: "交通系IC", sortOrder: 50 },
  { code: "voucher", labelJa: "金券・商品券", sortOrder: 60 },
  { code: "other", labelJa: "その他", sortOrder: 99 },
];

async function main() {
  for (const m of DEFAULT_METHODS) {
    await prisma.paymentMethodDefinition.upsert({
      where: { code: m.code },
      create: m,
      update: { labelJa: m.labelJa, sortOrder: m.sortOrder },
    });
  }
  console.log("Seed OK: payment method definitions only (no sample store or menu).");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
