-- Seat category for net reserve filtering and reception display

ALTER TABLE "Table"
ADD COLUMN "seatType" TEXT NOT NULL DEFAULT '';
