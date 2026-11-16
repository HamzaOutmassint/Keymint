-- Phase 5 adds an opaque synchronization cursor. Credential semantics remain
-- exclusively inside VaultRecord.ciphertext; the sequence reveals only change order.
ALTER TABLE "Vault" ADD COLUMN "syncSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VaultRecord" ADD COLUMN "syncSequence" INTEGER NOT NULL DEFAULT 0;

UPDATE "VaultRecord" SET "syncSequence" = 1;
UPDATE "Vault" SET "syncSequence" = 1
WHERE EXISTS (SELECT 1 FROM "VaultRecord" WHERE "VaultRecord"."vaultId" = "Vault"."id");

CREATE INDEX "VaultRecord_ownerId_vaultId_syncSequence_idx"
  ON "VaultRecord"("ownerId", "vaultId", "syncSequence");

CREATE TABLE "VaultMutation" (
  "id" TEXT NOT NULL,
  "vaultId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VaultMutation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VaultMutation_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId")
    REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VaultMutation_vaultId_mutationId_key" ON "VaultMutation"("vaultId", "mutationId");
CREATE INDEX "VaultMutation_ownerId_vaultId_idx" ON "VaultMutation"("ownerId", "vaultId");
