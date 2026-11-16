import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260924160000_remove_better_auth_account_issuer/migration.sql",
  "utf8",
);

describe("Better Auth account schema", () => {
  it("identifies accounts by provider and account id (Better Auth >= 1.7.3)", () => {
    expect(schema).not.toMatch(/model Account \{[\s\S]*?issuer\s+String[\s\S]*?\n\}/);
    expect(schema).toContain("@@unique([providerId, accountId])");
    expect(schema).not.toContain("@@unique([issuer, accountId])");
  });

  it("removes the 1.7.0-1.7.2 issuer column and restores the provider index", () => {
    expect(migration.indexOf('DROP INDEX IF EXISTS "account_issuer_accountId_key"')).toBeLessThan(
      migration.indexOf('DROP COLUMN IF EXISTS "issuer"'),
    );
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "account_providerId_accountId_key"');
  });
});
