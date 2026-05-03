-- OrderLine.lineExtra (Prisma Json) — set orders / extra line payload
ALTER TABLE "OrderLine" ADD COLUMN "lineExtra" JSONB;
