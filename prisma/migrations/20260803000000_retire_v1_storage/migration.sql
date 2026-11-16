-- The compatibility window is closed. Refuse to discard a live V1 authority;
-- operators must migrate or explicitly reset those accounts before deployment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Credential")
    OR EXISTS (SELECT 1 FROM "Category")
    OR EXISTS (
      SELECT 1 FROM "user"
      WHERE "masterPasswordHash" IS NOT NULL OR "keySalt" IS NOT NULL
    )
    OR EXISTS (SELECT 1 FROM "Vault" WHERE "state" <> 'v2')
  THEN
    RAISE EXCEPTION 'V1 vault data still exists; migrate or reset it before retiring V1 storage';
  END IF;
END $$;

DROP TABLE "VaultMigrationItem";
DROP TABLE "VaultStagedRecord";
DROP TABLE "VaultStagedKeyEnvelope";
DROP TABLE "VaultMigration";
DROP TABLE "Credential";
DROP TABLE "Category";
DROP TABLE "AccountSettings";

ALTER TABLE "user"
  DROP COLUMN "masterPasswordHash",
  DROP COLUMN "masterPasswordHint",
  DROP COLUMN "keySalt",
  DROP COLUMN "masterSetupAt";

ALTER TABLE "Vault"
  DROP CONSTRAINT "Vault_versions_check",
  DROP CONSTRAINT "Vault_state_check",
  DROP CONSTRAINT "Vault_pending_rotation_check",
  DROP COLUMN "schemaVersion",
  DROP COLUMN "currentGeneration",
  DROP COLUMN "pendingKeyVersion",
  DROP COLUMN "pendingGeneration",
  DROP COLUMN "state",
  DROP COLUMN "migrationSequence";

DROP INDEX IF EXISTS "Vault_userId_state_idx";
DROP INDEX IF EXISTS "Vault_state_updatedAt_idx";

ALTER TABLE "Vault" ADD CONSTRAINT "Vault_versions_check" CHECK (
  "protocolVersion" = 2 AND "currentKeyVersion" >= 1 AND "syncSequence" >= 0
);

ALTER TABLE "VaultKeyEnvelope"
  DROP CONSTRAINT "VaultKeyEnvelope_metadata_check",
  DROP CONSTRAINT "VaultKeyEnvelope_retirement_check",
  DROP COLUMN "generation",
  DROP COLUMN "status",
  DROP COLUMN "retiredAt";

DROP INDEX IF EXISTS "VaultKeyEnvelope_ownerId_vaultId_idx";
DROP INDEX IF EXISTS "VaultKeyEnvelope_ownerId_vaultId_keyVersion_status_idx";
CREATE INDEX "VaultKeyEnvelope_ownerId_vaultId_keyVersion_idx"
  ON "VaultKeyEnvelope"("ownerId", "vaultId", "keyVersion");

ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_metadata_check" CHECK (
  "keyVersion" >= 1 AND
  "purpose" IN ('master', 'recovery') AND
  "wrapVersion" >= 1 AND "encryptionVersion" >= 1 AND
  length("nonce") > 0 AND length("ciphertext") > 0 AND
  "protected"->>'vaultId' = "vaultId" AND
  "protected"->>'ownerId' = "ownerId" AND
  "protected"->>'keyVersion' = "keyVersion"::TEXT AND
  "protected"->>'purpose' = "purpose" AND
  "protected"->>'wrapVersion' = "wrapVersion"::TEXT AND
  "protected"->>'wrapRevision' = "wrapRevision"
);

ALTER TABLE "VaultRecord"
  DROP CONSTRAINT "VaultRecord_metadata_check",
  DROP COLUMN "generation";

DROP INDEX IF EXISTS "VaultRecord_vaultId_generation_idx";
DROP INDEX IF EXISTS "VaultRecord_ownerId_vaultId_idx";

ALTER TABLE "VaultRecord" ADD CONSTRAINT "VaultRecord_metadata_check" CHECK (
  "keyVersion" >= 1 AND
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

ALTER TABLE "ActivityLog"
  DROP CONSTRAINT "ActivityLog_canonical_event_check",
  DROP COLUMN "metadata";

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_canonical_event_check" CHECK (
  "action" IN (
    'LOGIN', 'LOGOUT', 'PASSWORD_VIEWED', 'PASSWORD_COPIED',
    'PASSWORD_CREATED', 'PASSWORD_EDITED', 'PASSWORD_DELETED',
    'CATEGORY_CREATED', 'CATEGORY_DELETED', 'SETTINGS_CHANGED',
    'ACTIVITY_LOGS_PURGED', 'FAILED_LOGIN', 'FAILED_MASTER_VERIFICATION',
    'VAULT_EXPORTED', 'VAULT_IMPORTED'
  ) AND
  "description" = CASE "action"
    WHEN 'LOGIN' THEN 'Signed in to Keymint.'
    WHEN 'LOGOUT' THEN 'Signed out of Keymint.'
    WHEN 'PASSWORD_VIEWED' THEN 'Viewed a vault credential.'
    WHEN 'PASSWORD_COPIED' THEN 'Copied a vault credential.'
    WHEN 'PASSWORD_CREATED' THEN 'Created a vault credential.'
    WHEN 'PASSWORD_EDITED' THEN 'Updated a vault credential.'
    WHEN 'PASSWORD_DELETED' THEN 'Deleted a vault credential.'
    WHEN 'CATEGORY_CREATED' THEN 'Created a vault category.'
    WHEN 'CATEGORY_DELETED' THEN 'Deleted a vault category.'
    WHEN 'SETTINGS_CHANGED' THEN 'Updated account security preferences.'
    WHEN 'ACTIVITY_LOGS_PURGED' THEN 'Purged account activity logs.'
    WHEN 'FAILED_LOGIN' THEN 'A sign-in attempt failed.'
    WHEN 'FAILED_MASTER_VERIFICATION' THEN 'A vault unlock attempt failed.'
    WHEN 'VAULT_EXPORTED' THEN 'Exported the encrypted vault.'
    WHEN 'VAULT_IMPORTED' THEN 'Imported an encrypted vault.'
    ELSE NULL
  END AND
  "device" IN ('Mobile', 'Desktop') AND
  "browser" IN ('Edge', 'Firefox', 'Chrome', 'Safari', 'Unknown') AND
  "os" IN ('Windows', 'macOS', 'Android', 'iOS', 'Linux', 'Unknown') AND
  length("ip") BETWEEN 1 AND 64 AND
  "ip" !~ '[[:cntrl:]]'
);

-- The unique credential ID index already serves lookups on this column.
DROP INDEX "passkey_credentialID_idx";
