-- AlterTable
ALTER TABLE "StorePaymentMethod" ADD COLUMN "excludeFromSales" BOOLEAN NOT NULL DEFAULT false;

-- ポイント決済のみ売上除外を初期設定（長浜割などは含めない）
UPDATE "StorePaymentMethod" AS spm
SET "excludeFromSales" = true
FROM "PaymentMethodDefinition" AS d
WHERE spm."definitionId" = d.id
  AND (
    d."labelJa" LIKE '%ポイント%'
    OR d."code" IN ('point', 'points', 'point_use', 'point_redeem')
  );
