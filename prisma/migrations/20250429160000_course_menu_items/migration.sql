-- CreateTable
CREATE TABLE "CourseMenuItem" (
    "courseId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,

    PRIMARY KEY ("courseId", "menuItemId"),
    CONSTRAINT "CourseMenuItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseMenuItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourseMenuItem_menuItemId_idx" ON "CourseMenuItem"("menuItemId");
