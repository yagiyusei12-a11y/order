-- AlterTable
ALTER TABLE "StoreGame" ADD COLUMN "rewardMenuItemIds" JSONB NOT NULL DEFAULT '[]';

-- Migrate existing single reward to array
UPDATE "StoreGame"
SET "rewardMenuItemIds" = jsonb_build_array("rewardMenuItemId")
WHERE "rewardMenuItemId" IS NOT NULL;
