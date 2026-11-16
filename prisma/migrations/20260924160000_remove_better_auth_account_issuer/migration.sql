-- Better Auth 1.7.3 reverted account issuer scoping: accounts are identified by
-- providerId and accountId again, and new rows no longer write "issuer", so the
-- NOT NULL column would reject every sign-up. Every existing issuer value was
-- 'local:credential' for providerId 'credential', so the restored unique index
-- cannot collide. Drop the index before the column.
DROP INDEX IF EXISTS "account_issuer_accountId_key";

ALTER TABLE "account" DROP COLUMN IF EXISTS "issuer";

CREATE UNIQUE INDEX IF NOT EXISTS "account_providerId_accountId_key"
  ON "account"("providerId", "accountId");
