-- Phase 13 closes remaining application-owned integrity and retention gaps.
-- It fails rather than silently repairing a cross-owner legacy category link.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Credential" credential
    JOIN "Category" category ON category."id" = credential."categoryId"
    WHERE credential."categoryId" IS NOT NULL
      AND credential."userId" <> category."userId"
  ) THEN
    RAISE EXCEPTION 'Cross-owner legacy credential/category links must be audited before Phase 13';
  END IF;
END $$;

ALTER TABLE "Credential" ADD COLUMN "categoryUserId" TEXT;
UPDATE "Credential" SET "categoryUserId" = "userId" WHERE "categoryId" IS NOT NULL;

ALTER TABLE "Credential" DROP CONSTRAINT "Credential_categoryId_fkey";
CREATE UNIQUE INDEX "Category_id_userId_key" ON "Category"("id", "userId");
ALTER TABLE "Credential"
  ADD CONSTRAINT "Credential_categoryId_categoryUserId_fkey"
  FOREIGN KEY ("categoryId", "categoryUserId")
  REFERENCES "Category"("id", "userId")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_category_owner_check" CHECK (
  ("categoryId" IS NULL AND "categoryUserId" IS NULL) OR
  ("categoryId" IS NOT NULL AND "categoryUserId" = "userId")
);

-- Historical activity descriptions may contain credential names or client
-- supplied control characters. Replace them with the canonical event text and
-- discard old arbitrary metadata and raw addresses before adding constraints.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ActivityLog" WHERE "action" NOT IN (
      'LOGIN', 'LOGOUT', 'PASSWORD_VIEWED', 'PASSWORD_COPIED',
      'PASSWORD_CREATED', 'PASSWORD_EDITED', 'PASSWORD_DELETED',
      'CATEGORY_CREATED', 'CATEGORY_DELETED', 'SETTINGS_CHANGED',
      'ACTIVITY_LOGS_PURGED', 'FAILED_LOGIN', 'FAILED_MASTER_VERIFICATION',
      'VAULT_EXPORTED', 'VAULT_IMPORTED'
    )
  ) THEN
    RAISE EXCEPTION 'Unknown activity actions must be audited before Phase 13';
  END IF;
END $$;

UPDATE "ActivityLog" SET
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
  END,
  "metadata" = NULL,
  "ip" = 'Unavailable';

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_canonical_event_check" CHECK (
  "metadata" IS NULL AND
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

-- Retention scans are global, so their indexes must not begin with owner ID.
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");
CREATE INDEX "VaultMutation_createdAt_idx" ON "VaultMutation"("createdAt");
CREATE INDEX "VaultMigration_status_leaseExpiresAt_idx" ON "VaultMigration"("status", "leaseExpiresAt");
CREATE INDEX "rateLimit_lastRequest_idx" ON "rateLimit"("lastRequest");

-- Bound storage-layer values independently of request validation. Existing
-- authenticated envelopes already satisfy these Base64url and revision limits.
ALTER TABLE "VaultRecord" ADD CONSTRAINT "VaultRecord_encoding_bounds_check" CHECK (
  "nonce" ~ '^[A-Za-z0-9_-]{16}$' AND
  length("ciphertext") BETWEEN 22 AND 87403 AND "ciphertext" ~ '^[A-Za-z0-9_-]+$' AND
  "revision" ~ '^[1-9][0-9]{0,19}$' AND jsonb_typeof("protected") = 'object'
);
ALTER TABLE "VaultStagedRecord" ADD CONSTRAINT "VaultStagedRecord_encoding_bounds_check" CHECK (
  "nonce" ~ '^[A-Za-z0-9_-]{16}$' AND
  length("ciphertext") BETWEEN 22 AND 87403 AND "ciphertext" ~ '^[A-Za-z0-9_-]+$' AND
  "revision" ~ '^[1-9][0-9]{0,19}$' AND jsonb_typeof("protected") = 'object'
);
ALTER TABLE "VaultKeyEnvelope" ADD CONSTRAINT "VaultKeyEnvelope_encoding_bounds_check" CHECK (
  "nonce" ~ '^[A-Za-z0-9_-]{16}$' AND
  length("ciphertext") BETWEEN 22 AND 256 AND "ciphertext" ~ '^[A-Za-z0-9_-]+$' AND
  "wrapRevision" ~ '^[1-9][0-9]{0,19}$' AND jsonb_typeof("protected") = 'object'
);
ALTER TABLE "VaultStagedKeyEnvelope" ADD CONSTRAINT "VaultStagedKeyEnvelope_encoding_bounds_check" CHECK (
  "nonce" ~ '^[A-Za-z0-9_-]{16}$' AND
  length("ciphertext") BETWEEN 22 AND 256 AND "ciphertext" ~ '^[A-Za-z0-9_-]+$' AND
  "wrapRevision" ~ '^[1-9][0-9]{0,19}$' AND jsonb_typeof("protected") = 'object'
);
ALTER TABLE "VaultMutation" ADD CONSTRAINT "VaultMutation_response_bounds_check" CHECK (
  octet_length("response"::TEXT) <= 9000000
);
