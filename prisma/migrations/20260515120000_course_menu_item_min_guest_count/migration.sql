-- 人数が増えたときにコース対象に含める単品を段階的に広げる
ALTER TABLE "CourseMenuItem" ADD COLUMN "minGuestCount" INTEGER NOT NULL DEFAULT 1;
