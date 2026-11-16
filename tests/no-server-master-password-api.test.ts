import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const removedRoutes = [
  "app/api/vault/verify/route.ts",
  "app/api/vault/setup/route.ts",
  "app/api/vault/change/route.ts",
  "app/api/vault/export/route.ts",
  "app/api/vault/import/route.ts",
  "app/api/credentials/[id]/reveal/route.ts",
  "app/api/credentials/route.ts",
  "app/api/credentials/[id]/route.ts",
  "app/api/categories/route.ts",
  "app/api/categories/[id]/route.ts",
  "app/api/dashboard/route.ts",
  "app/api/search/route.ts",
  "app/api/v2/vault/migration/snapshot/route.ts",
  "app/api/v2/vault/migration/commit/route.ts",
  "app/api/account/delete/route.ts",
  "app/api/logs/purge/route.ts",
];

describe("server Master Password boundary", () => {
  it("removes every legacy API whose contract required a Master Password", () => {
    for (const route of removedRoutes) expect(existsSync(resolve(route)), route).toBe(false);
  });

  it("contains no Master Password parsing or verification in active vault API routes", () => {
    const activeRoutes = [
      "app/api/v2/vault/bootstrap/route.ts",
      "app/api/v2/vault/setup/route.ts",
      "app/api/v2/vault/sync/route.ts",
      "app/api/v2/vault/records/route.ts",
      "app/api/v2/vault/records/[id]/route.ts",
      "app/api/v2/vault/records/batch/route.ts",
    ];
    for (const route of activeRoutes) {
      const source = readFileSync(resolve(route), "utf8");
      expect(source, route).not.toMatch(/requireMasterPassword|body\.masterPassword|verifyMasterPassword/);
    }
  });
});
