-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "discountJson" JSONB;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN "discountJson" JSONB;
