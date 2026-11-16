-- Phase 12 keeps a verified TOTP active while a replacement is pending and
-- records the last accepted time-step so a code cannot be replayed.
ALTER TABLE "twoFactor"
  ADD COLUMN "lastUsedTotpStep" INTEGER,
  ADD COLUMN "pendingSecret" TEXT,
  ADD COLUMN "pendingBackupCodes" TEXT,
  ADD COLUMN "pendingExpiresAt" TIMESTAMP(3);

