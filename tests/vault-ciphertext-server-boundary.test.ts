import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const semanticRoutes = [
  "app/api/credentials/route.ts",
  "app/api/credentials/[id]/route.ts",
  "app/api/categories/route.ts",
  "app/api/categories/[id]/route.ts",
  "app/api/dashboard/route.ts",
  "app/api/search/route.ts",
];

describe("ciphertext-only server boundary", () => {
  it("removes every semantic vault API route", () => {
    for (const route of semanticRoutes) {
      expect(existsSync(route), route).toBe(false);
    }
    expect(existsSync("app/api/credentials/[id]/reveal/route.ts")).toBe(false);
  });

  it("contains no server-side vault decryption implementation", () => {
    expect(existsSync("server/security/encryption.ts")).toBe(false);
    const storage = readFileSync("server/vault-record-storage.ts", "utf8");
    expect(storage).not.toMatch(/decrypt|masterPassword|passwordHash|credentialSchema|categorySchema/i);
  });

  it("routes browser CRUD through encrypted create, update, delete, and synchronization", () => {
    const client = readFileSync("features/vault/data.ts", "utf8");
    expect(client).toContain('"/api/v2/vault/records"');
    expect(client).toContain('method: envelope.protected.state === "deleted" ? "DELETE" : "PUT"');
    expect(client).toContain("/api/v2/vault/sync?cursor=");
    expect(client).toContain("while (hasMore)");
    expect(client).not.toMatch(/\/api\/(credentials|categories|dashboard|search)/);
  });

  it("keeps import and export local to the unlocked browser", () => {
    const settings = readFileSync("app/(vault)/settings/page.tsx", "utf8");
    expect(settings).toContain("vaultCryptoClient.exportBackup");
    expect(settings).toContain("vaultCryptoClient.openBackup");
    expect(settings).not.toMatch(/\/api\/vault\/(import|export)/);
  });
});
