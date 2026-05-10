-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "guestDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "OrderLine_guestDeviceId_idx" ON "OrderLine"("guestDeviceId");
