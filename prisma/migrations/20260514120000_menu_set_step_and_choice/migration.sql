-- Set menu definition (schema had models; migrations were never added)
CREATE TABLE "MenuSetStep" (
    "id" TEXT NOT NULL,
    "setMenuItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minPick" INTEGER NOT NULL DEFAULT 1,
    "maxPick" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuSetStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuSetStep_setMenuItemId_idx" ON "MenuSetStep"("setMenuItemId");

ALTER TABLE "MenuSetStep" ADD CONSTRAINT "MenuSetStep_setMenuItemId_fkey" FOREIGN KEY ("setMenuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MenuSetChoice" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "componentMenuItemId" TEXT NOT NULL,
    "extraPrice" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuSetChoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuSetChoice_stepId_idx" ON "MenuSetChoice"("stepId");
CREATE INDEX "MenuSetChoice_componentMenuItemId_idx" ON "MenuSetChoice"("componentMenuItemId");

ALTER TABLE "MenuSetChoice" ADD CONSTRAINT "MenuSetChoice_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "MenuSetStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuSetChoice" ADD CONSTRAINT "MenuSetChoice_componentMenuItemId_fkey" FOREIGN KEY ("componentMenuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
