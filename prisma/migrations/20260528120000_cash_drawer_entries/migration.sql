-- CreateTable
CREATE TABLE "CashDrawerEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffUserId" TEXT,
    "kind" TEXT NOT NULL,
    "amountDeltaYen" INTEGER NOT NULL,
    "balanceAfterYen" INTEGER NOT NULL,
    "countedYen" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDrawerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDrawerEntry_storeId_createdAt_idx" ON "CashDrawerEntry"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "CashDrawerEntry" ADD CONSTRAINT "CashDrawerEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerEntry" ADD CONSTRAINT "CashDrawerEntry_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
