-- Link takeout net orders to SalesOrder (for kitchen/hall/ops flows)
ALTER TABLE "TakeoutNetOrder" ADD COLUMN "salesOrderId" TEXT;

CREATE UNIQUE INDEX "TakeoutNetOrder_salesOrderId_key" ON "TakeoutNetOrder"("salesOrderId");

