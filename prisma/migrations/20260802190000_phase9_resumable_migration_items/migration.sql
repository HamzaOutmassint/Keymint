-- Phase 9 adds per-record checkpoints without changing or deleting V1 data.
CREATE TABLE "VaultMigrationItem" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceDigest" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "ciphertextDigest" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "encryptedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "migratedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VaultMigrationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultMigrationItem_migrationId_sourceType_sourceId_key"
  ON "VaultMigrationItem"("migrationId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "VaultMigrationItem_migrationId_recordId_key"
  ON "VaultMigrationItem"("migrationId", "recordId");
CREATE INDEX "VaultMigrationItem_ownerId_migrationId_status_idx"
  ON "VaultMigrationItem"("ownerId", "migrationId", "status");
CREATE INDEX "VaultMigrationItem_migrationId_updatedAt_idx"
  ON "VaultMigrationItem"("migrationId", "updatedAt");

ALTER TABLE "VaultMigrationItem" ADD CONSTRAINT "VaultMigrationItem_migrationId_vaultId_ownerId_fkey"
  FOREIGN KEY ("migrationId", "vaultId", "ownerId")
  REFERENCES "VaultMigration"("id", "vaultId", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VaultMigrationItem" ADD CONSTRAINT "VaultMigrationItem_values_check" CHECK (
  "sourceType" IN ('category', 'credential') AND
  "sourceVersion" >= 1 AND "attemptCount" >= 0 AND
  "status" IN ('pending', 'downloaded', 'uploaded', 'migrated') AND
  length("sourceDigest") >= 32 AND
  (("status" = 'pending') OR "downloadedAt" IS NOT NULL) AND
  (("status" NOT IN ('uploaded', 'migrated')) OR
    ("encryptedAt" IS NOT NULL AND "uploadedAt" IS NOT NULL AND "ciphertextDigest" IS NOT NULL)) AND
  (("status" <> 'migrated') OR
    ("verifiedAt" IS NOT NULL AND "migratedAt" IS NOT NULL))
);
