-- AlterTable
ALTER TABLE "DiningSession" ADD COLUMN "mergedIntoSessionId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "sourceTableId" TEXT;

-- CreateIndex
CREATE INDEX "DiningSession_mergedIntoSessionId_idx" ON "DiningSession"("mergedIntoSessionId");

-- CreateIndex
CREATE INDEX "SalesOrder_sourceTableId_idx" ON "SalesOrder"("sourceTableId");

-- AddForeignKey
ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_mergedIntoSessionId_fkey" FOREIGN KEY ("mergedIntoSessionId") REFERENCES "DiningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_sourceTableId_fkey" FOREIGN KEY ("sourceTableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;
