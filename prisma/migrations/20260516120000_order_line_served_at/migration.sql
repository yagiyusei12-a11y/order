-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "servedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OrderLine_status_servedAt_idx" ON "OrderLine"("status", "servedAt");

-- 既存の提供済み行に並び用の時刻を補う（実際の提供時刻は不明なため調理完了時刻または注文作成時刻で代用）
UPDATE "OrderLine" AS l
SET "servedAt" = COALESCE(l."readyAt", o."createdAt")
FROM "SalesOrder" AS o
WHERE l."orderId" = o."id" AND l."status" = 'served' AND l."servedAt" IS NULL;
