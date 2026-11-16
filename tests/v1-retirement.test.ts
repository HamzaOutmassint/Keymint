import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const removedRoutes = [
  "app/(auth)/migrate-vault/page.tsx",
  "app/api/categories/route.ts",
  "app/api/credentials/route.ts",
  "app/api/dashboard/route.ts",
  "app/api/search/route.ts",
  "app/api/settings/route.ts",
  "app/api/v2/vault/migration/start/route.ts",
];

describe("V1 compatibility retirement", () => {
  it("removes live V1 routes and server modules", () => {
    for (const path of removedRoutes) expect(existsSync(path), path).toBe(false);
    expect(existsSync("server/legacy-migration.ts")).toBe(false);
    expect(existsSync("server/migration-engine.ts")).toBe(false);
    expect(existsSync("server/security/encryption.ts")).toBe(false);
  });

  it("removes legacy and unused persistence fields", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const name of [
      "Category",
      "Credential",
      "AccountSettings",
      "VaultMigration",
      "masterPasswordHash",
      "masterPasswordHint",
      "keySalt",
      "masterSetupAt",
      "pendingKeyVersion",
      "pendingGeneration",
      "retiredAt",
    ]) expect(schema, name).not.toContain(name);
  });

  it("fails the contraction before discarding a live V1 authority", () => {
    const migration = readFileSync(
      "prisma/migrations/20260803000000_retire_v1_storage/migration.sql",
      "utf8",
    );
    expect(migration).toContain("V1 vault data still exists");
    expect(migration).toContain('DROP TABLE "Credential"');
    expect(migration).toContain('DROP TABLE "VaultMigration"');
  });

  it("removes browser-local legacy backup import", () => {
    const runtime = readFileSync("features/vault/crypto-runtime.ts", "utf8");
    expect(runtime).not.toContain("openLegacyBackup");
    expect(existsSync("lib/vault-crypto/legacy.ts")).toBe(false);
  });
});
