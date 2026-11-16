-- Email is a login identifier and is normalized to lowercase by every
-- application-owned write. Enforce that identity boundary in PostgreSQL too.
CREATE UNIQUE INDEX "user_email_lower_key" ON "user" (LOWER("email"));

CREATE TABLE "EmailChangeRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldEmail" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "oldVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailChangeRequest_stage_check" CHECK (
    "stage" IN ('VERIFY_CURRENT_EMAIL', 'VERIFY_NEW_EMAIL')
  ),
  CONSTRAINT "EmailChangeRequest_token_hash_check" CHECK (
    "tokenHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "EmailChangeRequest_email_bounds_check" CHECK (
    length("oldEmail") BETWEEN 3 AND 254 AND
    length("newEmail") BETWEEN 3 AND 254 AND
    "oldEmail" = LOWER("oldEmail") AND
    "newEmail" = LOWER("newEmail") AND
    "oldEmail" <> "newEmail"
  ),
  CONSTRAINT "EmailChangeRequest_stage_state_check" CHECK (
    ("stage" = 'VERIFY_CURRENT_EMAIL' AND "oldVerifiedAt" IS NULL) OR
    ("stage" = 'VERIFY_NEW_EMAIL' AND "oldVerifiedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "EmailChangeRequest_userId_key" ON "EmailChangeRequest"("userId");
CREATE UNIQUE INDEX "EmailChangeRequest_tokenHash_key" ON "EmailChangeRequest"("tokenHash");
CREATE INDEX "EmailChangeRequest_expiresAt_idx" ON "EmailChangeRequest"("expiresAt");
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add canonical email-change audit events without allowing arbitrary activity
-- descriptions or metadata to enter the activity log.
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_canonical_event_check";
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_canonical_event_check" CHECK (
  "action" IN (
    'LOGIN', 'LOGOUT', 'PASSWORD_VIEWED', 'PASSWORD_COPIED',
    'PASSWORD_CREATED', 'PASSWORD_EDITED', 'PASSWORD_DELETED',
    'CATEGORY_CREATED', 'CATEGORY_DELETED', 'SETTINGS_CHANGED',
    'EMAIL_CHANGE_REQUESTED', 'EMAIL_CHANGED', 'EMAIL_CHANGE_CANCELLED',
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
    WHEN 'EMAIL_CHANGE_REQUESTED' THEN 'Requested an account email change.'
    WHEN 'EMAIL_CHANGED' THEN 'Changed the account email address.'
    WHEN 'EMAIL_CHANGE_CANCELLED' THEN 'Cancelled a pending account email change.'
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
