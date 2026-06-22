-- AlterTable
ALTER TABLE "KitchenStation" ADD COLUMN "busyStoppedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "busyStopTarget" BOOLEAN NOT NULL DEFAULT false;
