-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "MenuCategory_parentId_idx" ON "MenuCategory"("parentId");
