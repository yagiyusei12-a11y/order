-- CreateTable
CREATE TABLE "StoreGame" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "iconEmoji" TEXT,
    "playPriceYen" INTEGER NOT NULL DEFAULT 88,
    "rewardMenuItemId" TEXT,
    "winMode" TEXT NOT NULL DEFAULT 'random',
    "winProbabilityPercent" INTEGER NOT NULL DEFAULT 30,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlay" (
    "id" TEXT NOT NULL,
    "storeGameId" TEXT NOT NULL,
    "billingSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "feeOrderLineId" TEXT,
    "rewardOrderLineId" TEXT,
    "guestDeviceId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreGame_storeId_idx" ON "StoreGame"("storeId");

-- CreateIndex
CREATE INDEX "StoreGame_rewardMenuItemId_idx" ON "StoreGame"("rewardMenuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreGame_storeId_slug_key" ON "StoreGame"("storeId", "slug");

-- CreateIndex
CREATE INDEX "GamePlay_storeGameId_idx" ON "GamePlay"("storeGameId");

-- CreateIndex
CREATE INDEX "GamePlay_billingSessionId_idx" ON "GamePlay"("billingSessionId");

-- CreateIndex
CREATE INDEX "GamePlay_status_idx" ON "GamePlay"("status");

-- AddForeignKey
ALTER TABLE "StoreGame" ADD CONSTRAINT "StoreGame_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreGame" ADD CONSTRAINT "StoreGame_rewardMenuItemId_fkey" FOREIGN KEY ("rewardMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlay" ADD CONSTRAINT "GamePlay_storeGameId_fkey" FOREIGN KEY ("storeGameId") REFERENCES "StoreGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlay" ADD CONSTRAINT "GamePlay_billingSessionId_fkey" FOREIGN KEY ("billingSessionId") REFERENCES "DiningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
