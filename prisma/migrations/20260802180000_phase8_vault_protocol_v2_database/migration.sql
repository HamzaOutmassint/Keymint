-- Phase 8 is deliberately additive. Legacy User, Category, Credential, and
-- verification columns remain available throughout the compatibility window.

-- AlterTable
ALTER TABLE "Vault" ADD COLUMN     "currentGeneration" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "migrationSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pendingGeneration" INTEGER,
ADD COLUMN     "pendingKeyVersion" INTEGER,
ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VaultKeyEnvelope" ADD COLUMN     "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "wrapVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VaultRecord" ADD COLUMN     "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "envelopeVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "payloadVersion" INTEGER NOT NULL DEFAULT 1;

-- Derive the duplicated routing/version fields from authenticated protected
-- headers before enforcing parity. Phase 5 headers have no encryptionVersion,
-- which is the defined encryption-version 1 representation.
UPDATE "VaultKeyEnvelope"
SET "wrapVersion" = ("protected"->>'wrapVersion')::INTEGER;

UPDATE "VaultRecord"
SET "envelopeVersion" = ("protected"->>'envelopeVersion')::INTEGER,
    "payloadVersion" = ("protected"->>'payloadVersion')::INTEGER,
    "encryptionVersion" = COALESCE(("protected"->>'encryptionVersion')::INTEGER, 1);

-- CreateTable
CREATE TABLE "VaultMigration" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceProtocolVersion" INTEGER NOT NULL,
    "targetProtocolVersion" INTEGER NOT NULL,
    "sourceKeyVersion" INTEGER,
    "targetKeyVersion" INTEGER NOT NULL,
    "sourceGeneration" INTEGER NOT NULL DEFAULT 0,
    "targetGeneration" INTEGER NOT NULL DEFAULT 1,
    "snapshotSequence" INTEGER NOT NULL DEFAULT 0,
    "expectedRecordCount" INTEGER NOT NULL,
    "stagedRecordCount" INTEGER NOT NULL DEFAULT 0,
    "stagedEnvelopeCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotDigest" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultMigration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultStagedKeyEnvelope" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "wrapVersion" INTEGER NOT NULL,
    "wrapRevision" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL,
    "protected" JSONB NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultStagedKeyEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultStagedRecord" (
    "id" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "envelopeVersion" INTEGER NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "encryptionVersion" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "protected" JSONB NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultStagedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultMigration_ownerId_status_createdAt_idx" ON "VaultMigration"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VaultMigration_vaultId_status_leaseExpiresAt_idx" ON "VaultMigration"("vaultId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultMigration_id_vaultId_ownerId_key" ON "VaultMigration"("id", "vaultId", "ownerId");

-- CreateIndex
CREATE INDEX "VaultStagedKeyEnvelope_ownerId_migrationId_idx" ON "VaultStagedKeyEnvelope"("ownerId", "migrationId");

-- CreateIndex
CREATE INDEX "VaultStagedKeyEnvelope_vaultId_generation_keyVersion_idx" ON "VaultStagedKeyEnvelope"("vaultId", "generation", "keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VaultStagedKeyEnvelope_migrationId_keyVersion_purpose_key" ON "VaultStagedKeyEnvelope"("migrationId", "keyVersion", "purpose");

-- CreateIndex
CREATE INDEX "VaultStagedRecord_ownerId_migrationId_idx" ON "VaultStagedRecord"("ownerId", "migrationId");

-- CreateIndex
CREATE INDEX "VaultStagedRecord_vaultId_generation_keyVersion_idx" ON "VaultStagedRecord"("vaultId", "generation", "keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VaultStagedRecord_migrationId_recordId_key" ON "VaultStagedRecord"("migrationId", "recordId");

-- CreateIndex
CREATE INDEX "Vault_state_updatedAt_idx" ON "Vault"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "VaultKeyEnvelope_ownerId_vaultId_keyVersion_status_idx" ON "VaultKeyEnvelope"("ownerId", "vaultId", "keyVersion", "status");

-- CreateIndex
CREATE INDEX "VaultRecord_vaultId_keyVersion_state_idx" ON "VaultRecord"("vaultId", "keyVersion", "state");

-- CreateIndex
CREATE INDEX "VaultRecord_vaultId_generation_idx" ON "VaultRecord"("vaultId", "generation");

-- CreateIndex
CREATE INDEX "verification_identifier_createdAt_idx" ON "verification"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "verification_expiresAt_idx" ON "verification"("expiresAt");

-- AddForeignKey
ALTER TABLE "VaultMigration" ADD CONSTRAINT "VaultMigration_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMigration" ADD CONSTRAINT "VaultMigration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultStagedKeyEnvelope" ADD CONSTRAINT "VaultStagedKeyEnvelope_migrationId_vaultId_ownerId_fkey" FOREIGN KEY ("migrationId", "vaultId", "ownerId") REFERENCES "VaultMigration"("id", "vaultId", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultStagedKeyEnvelope" ADD CONSTRAINT "VaultStagedKeyEnvelope_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultStagedRecord" ADD CONSTRAINT "VaultStagedRecord_migrationId_vaultId_ownerId_fkey" FOREIGN KEY ("migrationId", "vaultId", "ownerId") REFERENCES "VaultMigration"("id", "vaultId", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultStagedRecord" ADD CONSTRAINT "VaultStagedRecord_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- State, version, and generation invariants reserve an isolated next
-- generation for future atomic Vault Key rotation.
ALTER TABLE "Vault" ADD CONSTRAINT "Vault_versions_check" CHECK (
    "protocolVersion" >= 2 AND "schemaVersion" >= 1 AND
    "currentKeyVersion" >= 1 AND "currentGeneration" >= 1 AND
    "syncSequence" >= 0 AND "migrationSequence" >= 0
);
ALTER TABLE "Vault" ADD CONSTRAINT "Vault_state_check"
    CHECK ("state" IN ('v2', 'transitional', 'rotating'));
ALTER TABLE "Vault" ADD CONSTRAINT "Vault_pending_rotation_check" CHECK (
    ("pendingKeyVersion" IS NULL AND "pendingGeneration" IS NULL) OR
    ("pendingKeyVersion" > "currentKeyVersion" AND "pendingGeneration" > "currentGeneration")
);

-- Live wrapped keys and encrypted payloads must agree with their authenticated
-- routing headers. This detects repository bugs or database-side corruption
-- before opaque bytes are sent to a client.
ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_metadata_check" CHECK (
    "keyVersion" >= 1 AND "generation" >= 1 AND
    "purpose" IN ('master', 'recovery') AND "status" IN ('active', 'retired') AND
    "wrapVersion" >= 1 AND "encryptionVersion" >= 1 AND
    length("nonce") > 0 AND length("ciphertext") > 0 AND
    "protected"->>'vaultId' = "vaultId" AND
    "protected"->>'ownerId' = "ownerId" AND
    "protected"->>'keyVersion' = "keyVersion"::TEXT AND
    "protected"->>'purpose' = "purpose" AND
    "protected"->>'wrapVersion' = "wrapVersion"::TEXT AND
    "protected"->>'wrapRevision' = "wrapRevision"
);
ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_retirement_check" CHECK (
    ("status" = 'active' AND "retiredAt" IS NULL) OR
    ("status" = 'retired' AND "retiredAt" IS NOT NULL)
);

ALTER TABLE "VaultRecord" ADD CONSTRAINT "VaultRecord_metadata_check" CHECK (
    "keyVersion" >= 1 AND "generation" >= 1 AND
    "envelopeVersion" >= 1 AND "payloadVersion" >= 1 AND "encryptionVersion" >= 1 AND
    "syncSequence" >= 0 AND "state" IN ('active', 'deleted') AND
    length("nonce") > 0 AND length("ciphertext") > 0 AND
    "protected"->>'vaultId' = "vaultId" AND
    "protected"->>'ownerId' = "ownerId" AND
    "protected"->>'recordId' = "recordId" AND
    "protected"->>'keyVersion' = "keyVersion"::TEXT AND
    "protected"->>'envelopeVersion' = "envelopeVersion"::TEXT AND
    "protected"->>'payloadVersion' = "payloadVersion"::TEXT AND
    COALESCE("protected"->>'encryptionVersion', '1') = "encryptionVersion"::TEXT AND
    "protected"->>'revision' = "revision" AND
    "protected"->>'state' = "state"
);

-- Transition rows contain only bounded counters, opaque digests, and encrypted
-- staging material. All ownership paths are composite foreign keys.
ALTER TABLE "VaultMigration" ADD CONSTRAINT "VaultMigration_values_check" CHECK (
    "kind" IN ('protocol', 'key_rotation') AND
    "status" IN ('pending', 'staging', 'ready', 'committed', 'aborted', 'expired') AND
    "sourceProtocolVersion" >= 1 AND "targetProtocolVersion" >= 2 AND
    ("sourceKeyVersion" IS NULL OR "sourceKeyVersion" >= 1) AND
    "targetKeyVersion" >= 1 AND "sourceGeneration" >= 0 AND "targetGeneration" >= 1 AND
    "snapshotSequence" >= 0 AND "expectedRecordCount" >= 0 AND
    "stagedRecordCount" >= 0 AND "stagedEnvelopeCount" >= 0
);
ALTER TABLE "VaultMigration" ADD CONSTRAINT "VaultMigration_completion_check" CHECK (
    ("status" IN ('committed', 'aborted', 'expired') AND "completedAt" IS NOT NULL) OR
    ("status" IN ('pending', 'staging', 'ready') AND "completedAt" IS NULL)
);

ALTER TABLE "VaultStagedKeyEnvelope" ADD CONSTRAINT "VaultStagedKeyEnvelope_metadata_check" CHECK (
    "keyVersion" >= 1 AND "generation" >= 1 AND "purpose" IN ('master', 'recovery') AND
    "wrapVersion" >= 1 AND "encryptionVersion" >= 1 AND
    length("nonce") > 0 AND length("ciphertext") > 0 AND
    "protected"->>'vaultId' = "vaultId" AND
    "protected"->>'ownerId' = "ownerId" AND
    "protected"->>'keyVersion' = "keyVersion"::TEXT AND
    "protected"->>'purpose' = "purpose" AND
    "protected"->>'wrapVersion' = "wrapVersion"::TEXT AND
    "protected"->>'wrapRevision' = "wrapRevision"
);

ALTER TABLE "VaultStagedRecord" ADD CONSTRAINT "VaultStagedRecord_metadata_check" CHECK (
    "keyVersion" >= 1 AND "generation" >= 1 AND
    "envelopeVersion" >= 1 AND "payloadVersion" >= 1 AND "encryptionVersion" >= 1 AND
    "state" IN ('active', 'deleted') AND length("nonce") > 0 AND length("ciphertext") > 0 AND
    "protected"->>'vaultId' = "vaultId" AND
    "protected"->>'ownerId' = "ownerId" AND
    "protected"->>'recordId' = "recordId" AND
    "protected"->>'keyVersion' = "keyVersion"::TEXT AND
    "protected"->>'envelopeVersion' = "envelopeVersion"::TEXT AND
    "protected"->>'payloadVersion' = "payloadVersion"::TEXT AND
    COALESCE("protected"->>'encryptionVersion', '1') = "encryptionVersion"::TEXT AND
    "protected"->>'revision' = "revision" AND
    "protected"->>'state' = "state"
);
