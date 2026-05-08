-- Takeout support
-- - MenuItem.allowTakeout
-- - OrderLine.eatMode + taxRatePercent (per-line tax rate)
-- - TakeoutNetOrder table for offsite pickup orders

ALTER TABLE "MenuItem" ADD COLUMN "allowTakeout" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrderLine" ADD COLUMN "eatMode" TEXT NOT NULL DEFAULT 'dine_in';
ALTER TABLE "OrderLine" ADD COLUMN "taxRatePercent" INTEGER NOT NULL DEFAULT 10;

CREATE TABLE "TakeoutNetOrder" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "pickupAt" TIMESTAMP(3) NOT NULL,
  "customerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "note" TEXT,
  "lines" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TakeoutNetOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TakeoutNetOrder_storeId_idx" ON "TakeoutNetOrder"("storeId");
CREATE INDEX "TakeoutNetOrder_storeId_status_idx" ON "TakeoutNetOrder"("storeId", "status");
CREATE INDEX "TakeoutNetOrder_storeId_pickupAt_idx" ON "TakeoutNetOrder"("storeId", "pickupAt");

ALTER TABLE "TakeoutNetOrder" ADD CONSTRAINT "TakeoutNetOrder_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

