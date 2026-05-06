-- Prevent double-booking seats by net/staff reservations

CREATE TABLE "ReceptionReservationSeat" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "shiftKey" TEXT NOT NULL,
  "seatId" TEXT NOT NULL,
  "resKey" TEXT NOT NULL,

  CONSTRAINT "ReceptionReservationSeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceptionReservationSeat_storeId_shiftKey_seatId_key"
  ON "ReceptionReservationSeat"("storeId","shiftKey","seatId");

CREATE INDEX "ReceptionReservationSeat_storeId_resKey_idx"
  ON "ReceptionReservationSeat"("storeId","resKey");

CREATE INDEX "ReceptionReservationSeat_storeId_shiftKey_idx"
  ON "ReceptionReservationSeat"("storeId","shiftKey");

ALTER TABLE "ReceptionReservationSeat"
  ADD CONSTRAINT "ReceptionReservationSeat_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

