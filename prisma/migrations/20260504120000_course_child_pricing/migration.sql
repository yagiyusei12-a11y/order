-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "childPricePerPerson" INTEGER;

-- AlterTable
ALTER TABLE "DiningSession" ADD COLUMN "childCount" INTEGER NOT NULL DEFAULT 0;
