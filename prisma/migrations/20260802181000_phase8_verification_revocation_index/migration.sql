-- Phase 8 remains deliberately additive. Better Auth stores hashed lookup
-- identifiers, while Keymint revokes user-associated verification state by
-- value after password resets and factor changes.
CREATE INDEX "verification_value_idx" ON "verification"("value");
