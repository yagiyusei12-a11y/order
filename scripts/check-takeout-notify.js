import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const conf = await prisma.receptionConfig.findUnique({ where: { storeId: "harunoyukoto" } });
  const c = conf?.data && typeof conf.data === "object" ? conf.data : {};
  const orders = await prisma.takeoutNetOrder.findMany({
    where: { storeId: "harunoyukoto" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, email: true, customerName: true, createdAt: true, status: true },
  });
  console.log(
    JSON.stringify(
      {
        netReserveNotifyEmails: c.netReserveNotifyEmails ?? null,
        takeoutNetNotifyEmails: c.takeoutNetNotifyEmails ?? null,
        recentOrders: orders,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
