-- CreateTable
CREATE TABLE "CourseOptionPack" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "extraPrice" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CourseOptionPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseOptionPackMenuItem" (
    "packId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    CONSTRAINT "CourseOptionPackMenuItem_pkey" PRIMARY KEY ("packId","menuItemId")
);

-- CreateIndex
CREATE INDEX "CourseOptionPack_courseId_idx" ON "CourseOptionPack"("courseId");

-- CreateIndex
CREATE INDEX "CourseOptionPackMenuItem_menuItemId_idx" ON "CourseOptionPackMenuItem"("menuItemId");

-- AddForeignKey
ALTER TABLE "CourseOptionPack" ADD CONSTRAINT "CourseOptionPack_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseOptionPackMenuItem" ADD CONSTRAINT "CourseOptionPackMenuItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "CourseOptionPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseOptionPackMenuItem" ADD CONSTRAINT "CourseOptionPackMenuItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "DiningSession" ADD COLUMN "purchasedCourseOptionPackIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
