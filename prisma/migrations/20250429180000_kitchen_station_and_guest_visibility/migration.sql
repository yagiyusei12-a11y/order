-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN "visibleToGuest" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "KitchenStation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KitchenStation_storeId_idx" ON "KitchenStation"("storeId");

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "kitchenStationId" TEXT;
CREATE INDEX "MenuItem_kitchenStationId_idx" ON "MenuItem"("kitchenStationId");
