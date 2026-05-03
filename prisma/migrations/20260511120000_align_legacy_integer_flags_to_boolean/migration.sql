-- Legacy SQLite-style INTEGER (0/1) columns vs Prisma Boolean — aligned for PostgreSQL wire types.
-- Fixes protocol/decoding issues (e.g. P08 / insufficient data) when querying Course and related tables.

ALTER TABLE "Table" ALTER COLUMN "active" DROP DEFAULT;
ALTER TABLE "Table" ALTER COLUMN "active" TYPE BOOLEAN USING ("active" <> 0);
ALTER TABLE "Table" ALTER COLUMN "active" SET DEFAULT true;

ALTER TABLE "Course" ALTER COLUMN "active" DROP DEFAULT;
ALTER TABLE "Course" ALTER COLUMN "active" TYPE BOOLEAN USING ("active" <> 0);
ALTER TABLE "Course" ALTER COLUMN "active" SET DEFAULT true;

ALTER TABLE "MenuItem" ALTER COLUMN "isAvailable" DROP DEFAULT;
ALTER TABLE "MenuItem" ALTER COLUMN "isAvailable" TYPE BOOLEAN USING ("isAvailable" <> 0);
ALTER TABLE "MenuItem" ALTER COLUMN "isAvailable" SET DEFAULT true;

ALTER TABLE "KitchenStation" ALTER COLUMN "active" DROP DEFAULT;
ALTER TABLE "KitchenStation" ALTER COLUMN "active" TYPE BOOLEAN USING ("active" <> 0);
ALTER TABLE "KitchenStation" ALTER COLUMN "active" SET DEFAULT true;

ALTER TABLE "MenuCategory" ALTER COLUMN "visibleToGuest" DROP DEFAULT;
ALTER TABLE "MenuCategory" ALTER COLUMN "visibleToGuest" TYPE BOOLEAN USING ("visibleToGuest" <> 0);
ALTER TABLE "MenuCategory" ALTER COLUMN "visibleToGuest" SET DEFAULT true;

ALTER TABLE "StorePaymentMethod" ALTER COLUMN "enabled" DROP DEFAULT;
ALTER TABLE "StorePaymentMethod" ALTER COLUMN "enabled" TYPE BOOLEAN USING ("enabled" <> 0);
ALTER TABLE "StorePaymentMethod" ALTER COLUMN "enabled" SET DEFAULT true;
