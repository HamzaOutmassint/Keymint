CREATE TABLE "VaultKeyRotation" (
  "id" TEXT NOT NULL,
  "vaultId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sourceKeyVersion" INTEGER NOT NULL,
  "targetKeyVersion" INTEGER NOT NULL,
  "snapshotSequence" INTEGER NOT NULL,
  "expectedRecordCount" INTEGER NOT NULL,
  "masterProtected" JSONB NOT NULL,
  "masterNonce" TEXT NOT NULL,
  "masterCiphertext" TEXT NOT NULL,
  "recoveryProtected" JSONB NOT NULL,
  "recoveryNonce" TEXT NOT NULL,
  "recoveryCiphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VaultKeyRotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultKeyRotationRecord" (
  "id" TEXT NOT NULL,
  "rotationId" TEXT NOT NULL,
  "vaultId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL,
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
  CONSTRAINT "VaultKeyRotationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VaultKeyRotation_vaultId_key" ON "VaultKeyRotation"("vaultId");
CREATE UNIQUE INDEX "VaultKeyRotation_id_vaultId_ownerId_key" ON "VaultKeyRotation"("id", "vaultId", "ownerId");
CREATE UNIQUE INDEX "VaultKeyRotation_vaultId_ownerId_key" ON "VaultKeyRotation"("vaultId", "ownerId");
CREATE INDEX "VaultKeyRotation_ownerId_updatedAt_idx" ON "VaultKeyRotation"("ownerId", "updatedAt");
CREATE UNIQUE INDEX "VaultKeyRotationRecord_rotationId_recordId_key" ON "VaultKeyRotationRecord"("rotationId", "recordId");
CREATE INDEX "VaultKeyRotationRecord_ownerId_rotationId_idx" ON "VaultKeyRotationRecord"("ownerId", "rotationId");

ALTER TABLE "VaultKeyRotation" ADD CONSTRAINT "VaultKeyRotation_vaultId_ownerId_fkey"
  FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultKeyRotationRecord" ADD CONSTRAINT "VaultKeyRotationRecord_rotationId_vaultId_ownerId_fkey"
  FOREIGN KEY ("rotationId", "vaultId", "ownerId") REFERENCES "VaultKeyRotation"("id", "vaultId", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VaultKeyRotation" ADD CONSTRAINT "VaultKeyRotation_values_check" CHECK (
  "targetKeyVersion" = "sourceKeyVersion" + 1 AND
  "snapshotSequence" >= 0 AND "expectedRecordCount" BETWEEN 0 AND 2500 AND
  length("masterNonce") BETWEEN 16 AND 32 AND length("masterCiphertext") BETWEEN 22 AND 256 AND
  length("recoveryNonce") BETWEEN 16 AND 32 AND length("recoveryCiphertext") BETWEEN 22 AND 256
);

ALTER TABLE "VaultKeyRotationRecord" ADD CONSTRAINT "VaultKeyRotationRecord_metadata_check" CHECK (
  "keyVersion" >= 2 AND "envelopeVersion" = 2 AND "payloadVersion" = 1 AND "encryptionVersion" = 2 AND
  "state" IN ('active', 'deleted') AND
  length("nonce") BETWEEN 16 AND 32 AND length("ciphertext") BETWEEN 22 AND 87403 AND
  "protected"->>'vaultId' = "vaultId" AND "protected"->>'ownerId' = "ownerId" AND
  "protected"->>'recordId' = "recordId" AND "protected"->>'keyVersion' = "keyVersion"::TEXT AND
  "protected"->>'revision' = "revision" AND "protected"->>'state' = "state"
);
