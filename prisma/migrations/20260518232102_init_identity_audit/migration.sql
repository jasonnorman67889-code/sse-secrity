-- CreateTable
CREATE TABLE "IdentityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "biometricType" TEXT,
    "riskScore" REAL NOT NULL DEFAULT 0.0,
    "locationData" JSONB
);

-- CreateTable
CREATE TABLE "EvidenceLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadHash" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "EvidenceLedger_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IdentityEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLedger_eventId_key" ON "EvidenceLedger"("eventId");

-- CreateIndex
CREATE INDEX "EvidenceLedger_createdAt_idx" ON "EvidenceLedger"("createdAt");
