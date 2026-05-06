-- Add seat capacity and mergeability metadata for reception reservations

ALTER TABLE "Table"
ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Table"
ADD COLUMN "mergeWith" JSONB NOT NULL DEFAULT '[]';

