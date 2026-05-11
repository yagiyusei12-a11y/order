-- AlterTable
ALTER TABLE "CashDrawerEntry" ADD COLUMN "sourcePaymentId" TEXT;

-- CreateIndex (PostgreSQL: multiple NULLs allowed in UNIQUE)
CREATE UNIQUE INDEX "CashDrawerEntry_storeId_sourcePaymentId_key" ON "CashDrawerEntry"("storeId", "sourcePaymentId");
