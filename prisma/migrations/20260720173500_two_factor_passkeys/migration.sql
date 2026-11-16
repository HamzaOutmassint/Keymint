ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "twoFactor" (
  "id" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "passkey" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aaguid" TEXT,
  CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "twoFactor_userId_key" ON "twoFactor"("userId");
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor"("secret");
CREATE UNIQUE INDEX "passkey_credentialID_key" ON "passkey"("credentialID");
CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");
CREATE INDEX "passkey_credentialID_idx" ON "passkey"("credentialID");
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
