-- CreateTable
CREATE TABLE "ReceptionConfig" (
  "storeId" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{"staff":6,"override":false,"manualWait":30}',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceptionConfig_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "ReceptionState" (
  "storeId" TEXT NOT NULL,
  "callReserved" BOOLEAN NOT NULL DEFAULT false,
  "callType" TEXT NOT NULL DEFAULT '',
  "entryQueue" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceptionState_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "ReceptionShift" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "shiftKey" TEXT NOT NULL,
  "seats" JSONB NOT NULL DEFAULT '[]',
  "waiting" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceptionShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceptionReservation" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "resKey" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "date" TEXT NOT NULL,
  "shift" TEXT NOT NULL,
  "status" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceptionReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceptionShift_storeId_shiftKey_key" ON "ReceptionShift"("storeId", "shiftKey");

-- CreateIndex
CREATE INDEX "ReceptionShift_storeId_idx" ON "ReceptionShift"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceptionReservation_storeId_resKey_key" ON "ReceptionReservation"("storeId", "resKey");

-- CreateIndex
CREATE INDEX "ReceptionReservation_storeId_idx" ON "ReceptionReservation"("storeId");

-- CreateIndex
CREATE INDEX "ReceptionReservation_storeId_date_idx" ON "ReceptionReservation"("storeId", "date");

-- AddForeignKey
ALTER TABLE "ReceptionConfig" ADD CONSTRAINT "ReceptionConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceptionState" ADD CONSTRAINT "ReceptionState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceptionShift" ADD CONSTRAINT "ReceptionShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceptionReservation" ADD CONSTRAINT "ReceptionReservation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

