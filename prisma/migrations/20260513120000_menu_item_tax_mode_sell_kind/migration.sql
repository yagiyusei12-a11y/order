-- MenuItem fields present in Prisma schema but not in early migrations
ALTER TABLE "MenuItem" ADD COLUMN "priceTaxMode" TEXT NOT NULL DEFAULT 'inclusive';
ALTER TABLE "MenuItem" ADD COLUMN "sellKind" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "MenuItem" ADD COLUMN "masterVersion" INTEGER NOT NULL DEFAULT 1;
