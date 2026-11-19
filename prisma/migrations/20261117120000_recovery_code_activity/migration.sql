-- Add canonical audit events for viewing and copying third-party 2FA recovery
-- codes stored inside encrypted credentials. The codes themselves never reach
-- the server; only these fixed action/description pairs are recorded.
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_canonical_event_check";
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_canonical_event_check" CHECK (
  "action" IN (
    'LOGIN', 'LOGOUT', 'PASSWORD_VIEWED', 'PASSWORD_COPIED',
    'PASSWORD_CREATED', 'PASSWORD_EDITED', 'PASSWORD_DELETED',
    'RECOVERY_CODES_VIEWED', 'RECOVERY_CODE_COPIED',
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
    WHEN 'RECOVERY_CODES_VIEWED' THEN 'Viewed credential recovery codes.'
    WHEN 'RECOVERY_CODE_COPIED' THEN 'Copied a credential recovery code.'
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
