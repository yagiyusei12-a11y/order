-- AlterTable
ALTER TABLE "Course" ADD COLUMN "guestVisibleSlots" JSONB NOT NULL DEFAULT '[]';
