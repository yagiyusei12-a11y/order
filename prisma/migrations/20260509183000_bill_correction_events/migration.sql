-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedByStaffUserId" TEXT;

-- CreateTable
CREATE TABLE "BillCorrectionEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "staffUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillCorrectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");

-- CreateIndex
CREATE INDEX "BillCorrectionEvent_storeId_idx" ON "BillCorrectionEvent"("storeId");

-- CreateIndex
CREATE INDEX "BillCorrectionEvent_billId_idx" ON "BillCorrectionEvent"("billId");

-- CreateIndex
CREATE INDEX "BillCorrectionEvent_createdAt_idx" ON "BillCorrectionEvent"("createdAt");

-- CreateIndex
CREATE INDEX "BillCorrectionEvent_kind_idx" ON "BillCorrectionEvent"("kind");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voidedByStaffUserId_fkey" FOREIGN KEY ("voidedByStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillCorrectionEvent" ADD CONSTRAINT "BillCorrectionEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillCorrectionEvent" ADD CONSTRAINT "BillCorrectionEvent_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillCorrectionEvent" ADD CONSTRAINT "BillCorrectionEvent_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

