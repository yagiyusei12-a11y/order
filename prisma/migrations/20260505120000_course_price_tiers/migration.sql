-- CreateTable
CREATE TABLE "CoursePriceTier" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "pricePerPerson" INTEGER NOT NULL,
    "childPricePerPerson" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CoursePriceTier_pkey" PRIMARY KEY ("id")
);

-- Data: one tier per existing course
INSERT INTO "CoursePriceTier" ("id", "courseId", "durationMinutes", "pricePerPerson", "childPricePerPerson", "sortOrder")
SELECT gen_random_uuid()::text, "id", "durationMinutes", "pricePerPerson", "childPricePerPerson", 0 FROM "Course";

CREATE UNIQUE INDEX "CoursePriceTier_courseId_durationMinutes_key" ON "CoursePriceTier"("courseId", "durationMinutes");
CREATE INDEX "CoursePriceTier_courseId_idx" ON "CoursePriceTier"("courseId");
ALTER TABLE "CoursePriceTier" ADD CONSTRAINT "CoursePriceTier_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old columns on Course
ALTER TABLE "Course" DROP COLUMN "durationMinutes";
ALTER TABLE "Course" DROP COLUMN "pricePerPerson";
ALTER TABLE "Course" DROP COLUMN "childPricePerPerson";

-- Link sessions to tier
ALTER TABLE "DiningSession" ADD COLUMN "coursePriceTierId" TEXT;
UPDATE "DiningSession" d
SET "coursePriceTierId" = (
  SELECT t."id" FROM "CoursePriceTier" t
  WHERE t."courseId" = d."courseId"
  ORDER BY t."sortOrder", t."durationMinutes"
  LIMIT 1
)
WHERE d."courseId" IS NOT NULL;

ALTER TABLE "DiningSession" ADD CONSTRAINT "DiningSession_coursePriceTierId_fkey"
  FOREIGN KEY ("coursePriceTierId") REFERENCES "CoursePriceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
