-- CreateTable
CREATE TABLE "MenuDiscontinueBallot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuDiscontinueBallot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuDiscontinueBallotItem" (
    "ballotId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,

    CONSTRAINT "MenuDiscontinueBallotItem_pkey" PRIMARY KEY ("ballotId","menuItemId")
);

-- CreateIndex
CREATE INDEX "MenuDiscontinueBallot_storeId_idx" ON "MenuDiscontinueBallot"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuDiscontinueBallot_storeId_staffName_key" ON "MenuDiscontinueBallot"("storeId", "staffName");

-- CreateIndex
CREATE INDEX "MenuDiscontinueBallotItem_menuItemId_idx" ON "MenuDiscontinueBallotItem"("menuItemId");

-- AddForeignKey
ALTER TABLE "MenuDiscontinueBallot" ADD CONSTRAINT "MenuDiscontinueBallot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDiscontinueBallotItem" ADD CONSTRAINT "MenuDiscontinueBallotItem_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "MenuDiscontinueBallot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDiscontinueBallotItem" ADD CONSTRAINT "MenuDiscontinueBallotItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
