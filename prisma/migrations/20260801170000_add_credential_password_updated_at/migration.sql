ALTER TABLE "Credential" ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);
UPDATE "Credential" SET "passwordUpdatedAt" = "updatedAt";
ALTER TABLE "Credential" ALTER COLUMN "passwordUpdatedAt" SET NOT NULL;
