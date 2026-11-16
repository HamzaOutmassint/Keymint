-- Better Auth 1.7 scopes account identity by issuer. This application has only
-- credential accounts, so its existing rows map unambiguously to the local
-- credential issuer. Stop rather than guessing if another legacy provider is
-- introduced before this migration runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    WHERE "providerId" <> 'credential'
  ) THEN
    RAISE EXCEPTION
      'Cannot safely backfill account issuer for a non-credential account';
  END IF;
END
$$;

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "providerId" = 'credential';

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

DROP INDEX IF EXISTS "account_providerId_accountId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_key"
  ON "account"("issuer", "accountId");
