-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "containsAlcohol" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DiningSession" ADD COLUMN "guestAlcoholAllowed" BOOLEAN;
