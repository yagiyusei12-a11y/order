-- CreateTable
CREATE TABLE "StoreTimeWindow" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreTimeWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemTimeDiscount" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "timeWindowId" TEXT NOT NULL,
    "discountKind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "MenuItemTimeDiscount_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN "guestVisibleTimeWindowId" TEXT;

-- CreateIndex
CREATE INDEX "StoreTimeWindow_storeId_idx" ON "StoreTimeWindow"("storeId");

-- CreateIndex
CREATE INDEX "MenuItemTimeDiscount_menuItemId_idx" ON "MenuItemTimeDiscount"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemTimeDiscount_timeWindowId_idx" ON "MenuItemTimeDiscount"("timeWindowId");

-- AddForeignKey
ALTER TABLE "StoreTimeWindow" ADD CONSTRAINT "StoreTimeWindow_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_guestVisibleTimeWindowId_fkey" FOREIGN KEY ("guestVisibleTimeWindowId") REFERENCES "StoreTimeWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemTimeDiscount" ADD CONSTRAINT "MenuItemTimeDiscount_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemTimeDiscount" ADD CONSTRAINT "MenuItemTimeDiscount_timeWindowId_fkey" FOREIGN KEY ("timeWindowId") REFERENCES "StoreTimeWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemTimeDiscount_menuItemId_timeWindowId_key" ON "MenuItemTimeDiscount"("menuItemId", "timeWindowId");
