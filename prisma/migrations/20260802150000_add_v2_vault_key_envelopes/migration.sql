CREATE TABLE "Vault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 2,
    "currentKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'v2',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vault_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultKeyEnvelope" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "wrapRevision" TEXT NOT NULL,
    "protected" JSONB NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VaultKeyEnvelope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VaultRecord" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "protected" JSONB NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VaultRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vault_userId_key" ON "Vault"("userId");
CREATE UNIQUE INDEX "Vault_id_userId_key" ON "Vault"("id", "userId");
CREATE INDEX "Vault_userId_state_idx" ON "Vault"("userId", "state");
CREATE UNIQUE INDEX "VaultKeyEnvelope_vaultId_keyVersion_purpose_key" ON "VaultKeyEnvelope"("vaultId", "keyVersion", "purpose");
CREATE INDEX "VaultKeyEnvelope_ownerId_vaultId_idx" ON "VaultKeyEnvelope"("ownerId", "vaultId");
CREATE UNIQUE INDEX "VaultRecord_vaultId_recordId_key" ON "VaultRecord"("vaultId", "recordId");
CREATE INDEX "VaultRecord_ownerId_vaultId_idx" ON "VaultRecord"("ownerId", "vaultId");

ALTER TABLE "Vault" ADD CONSTRAINT "Vault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultRecord" ADD CONSTRAINT "VaultRecord_vaultId_ownerId_fkey" FOREIGN KEY ("vaultId", "ownerId") REFERENCES "Vault"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
