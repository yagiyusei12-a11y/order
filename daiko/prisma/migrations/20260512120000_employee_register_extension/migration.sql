-- 従事者名簿等の追加項目（JSON）
ALTER TABLE "Employee" ADD COLUMN "registerExtension" JSONB NOT NULL DEFAULT '{}'::jsonb;