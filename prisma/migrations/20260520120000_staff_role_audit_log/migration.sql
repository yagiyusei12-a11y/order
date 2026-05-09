-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'staff';

-- CreateTable
CREATE TABLE "StaffAuditLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorStaffUserId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffAuditLog_storeId_createdAt_idx" ON "StaffAuditLog"("storeId", "createdAt");

ALTER TABLE "StaffAuditLog" ADD CONSTRAINT "StaffAuditLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffAuditLog" ADD CONSTRAINT "StaffAuditLog_actorStaffUserId_fkey" FOREIGN KEY ("actorStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 既存スタッフは従来どおり敏感操作の権限を維持（運用で役割を振り分け可能）
UPDATE "StaffUser" SET "role" = 'manager';
