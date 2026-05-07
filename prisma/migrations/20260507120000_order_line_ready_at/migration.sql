-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "readyAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OrderLine_status_readyAt_idx" ON "OrderLine"("status", "readyAt");

-- 既存の調理済み行に並び用の時刻を補う（実際の調理完了時刻は不明なため注文作成時刻で代用）
UPDATE "OrderLine" AS l
SET "readyAt" = o."createdAt"
FROM "SalesOrder" AS o
WHERE l."orderId" = o."id" AND l."status" = 'done' AND l."readyAt" IS NULL;
