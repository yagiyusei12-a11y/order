-- AlterTable
ALTER TABLE "AlcoholCheck"
ADD COLUMN "checkMethod" TEXT,
ADD COLUMN "checkMethodOther" TEXT,
ADD COLUMN "checkerName" TEXT,
ADD COLUMN "instructionNote" TEXT,
ADD COLUMN "otherNote" TEXT;

-- AlterTable
ALTER TABLE "DailyReport"
ADD COLUMN "breakEndAt" TIMESTAMP(3),
ADD COLUMN "breakLocation" TEXT,
ADD COLUMN "breakStartAt" TIMESTAMP(3),
ADD COLUMN "breakTaken" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dutyEndAt" TIMESTAMP(3),
ADD COLUMN "dutyStartAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantSettings"
ADD COLUMN "legalAlcoholDetectorModel" TEXT,
ADD COLUMN "legalAlcoholInspectionDate" TIMESTAMP(3),
ADD COLUMN "legalAlcoholInspectionDone" BOOLEAN,
ADD COLUMN "legalBodilyCoverage" TEXT,
ADD COLUMN "legalBusinessAddress" TEXT,
ADD COLUMN "legalCertificationDate" TIMESTAMP(3),
ADD COLUMN "legalCertificationNumber" TEXT,
ADD COLUMN "legalMainOfficeAddress" TEXT,
ADD COLUMN "legalMainOfficeName" TEXT,
ADD COLUMN "legalMutualAidContractFrom" TIMESTAMP(3),
ADD COLUMN "legalMutualAidContractTo" TIMESTAMP(3),
ADD COLUMN "legalMutualAidOrganizationName" TEXT,
ADD COLUMN "legalPhone" TEXT,
ADD COLUMN "legalPropertyCoverage" TEXT,
ADD COLUMN "legalPublicSafetyCommission" TEXT,
ADD COLUMN "legalRepresentativeName" TEXT,
ADD COLUMN "legalSafetyManagerName" TEXT,
ADD COLUMN "legalTradeName" TEXT,
ADD COLUMN "legalVehicleCoverageLimitManYen" TEXT;

-- AlterTable
ALTER TABLE "Vehicle"
ADD COLUMN "legalCoverageStartOn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ComplaintLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedBy" TEXT,
    "occurredOn" TIMESTAMP(3),
    "placeOrSection" TEXT,
    "driverEmployeeId" TEXT,
    "complainantName" TEXT,
    "complainantAddress" TEXT,
    "complainantContact" TEXT,
    "category" TEXT,
    "categoryOther" TEXT,
    "detail" TEXT,
    "causeAnalysis" TEXT,
    "rebuttal" TEXT,
    "correctiveAction" TEXT,
    "handlerName" TEXT,
    "completedOn" TIMESTAMP(3),
    "representativeChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidanceSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "location" TEXT,
    "instructorName" TEXT,
    "topicFeeCollection" BOOLEAN NOT NULL DEFAULT false,
    "topicTerms" BOOLEAN NOT NULL DEFAULT false,
    "topicConditionExplain" BOOLEAN NOT NULL DEFAULT false,
    "topicMarking" BOOLEAN NOT NULL DEFAULT false,
    "topicRoadTransportLaw" BOOLEAN NOT NULL DEFAULT false,
    "topicOther" TEXT,
    "topicOtherDetail" TEXT,
    "remarks" TEXT,
    "representativeChecked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuidanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidanceAttendee" (
    "id" TEXT NOT NULL,
    "guidanceSessionId" TEXT NOT NULL,
    "employeeId" TEXT,
    "attendeeName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidanceAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalChangeNotice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "changeType" TEXT,
    "submittedOn" TIMESTAMP(3),
    "changedOn" TIMESTAMP(3),
    "effectiveOn" TIMESTAMP(3),
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplaintLedger_tenantId_receivedAt_idx" ON "ComplaintLedger"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "GuidanceSession_tenantId_startedAt_idx" ON "GuidanceSession"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "GuidanceAttendee_guidanceSessionId_idx" ON "GuidanceAttendee"("guidanceSessionId");

-- CreateIndex
CREATE INDEX "LegalChangeNotice_tenantId_createdAt_idx" ON "LegalChangeNotice"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComplaintLedger" ADD CONSTRAINT "ComplaintLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintLedger" ADD CONSTRAINT "ComplaintLedger_driverEmployeeId_fkey" FOREIGN KEY ("driverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceSession" ADD CONSTRAINT "GuidanceSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceAttendee" ADD CONSTRAINT "GuidanceAttendee_guidanceSessionId_fkey" FOREIGN KEY ("guidanceSessionId") REFERENCES "GuidanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceAttendee" ADD CONSTRAINT "GuidanceAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeNotice" ADD CONSTRAINT "LegalChangeNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
