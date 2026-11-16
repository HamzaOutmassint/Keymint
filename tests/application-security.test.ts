import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "@/lib/security-policy";
import { RETENTION_DAYS, retentionCutoff } from "@/lib/retention-policy";
import {
  createLegacyVaultRecordProtectedHeader,
  encodeBase64Url,
} from "@/lib/vault-crypto";
import { activityPublicSelect, activityRecordData } from "@/server/activity";
import { validateMutationRecord, validateSubmittedRecord } from "@/server/v2-vault";
import { handleApiError } from "@/server/http";

const originalProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;

afterEach(() => {
  if (originalProxyCidrs === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
  else process.env.TRUSTED_PROXY_CIDRS = originalProxyCidrs;
  vi.restoreAllMocks();
});

describe("application security", () => {
  it("uses a per-request script nonce without unsafe-inline script execution", () => {
    const policy = contentSecurityPolicy("test-nonce", true);
    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("style-src-elem 'self'");
    expect(policy).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(readFileSync("proxy.ts", "utf8")).toContain('requestHeaders.set("x-nonce", nonce)');
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('export const dynamic = "force-dynamic"');
  });

  it("ignores client descriptions and minimizes untrusted forwarding metadata", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    const request = new Request("https://vault.example.test", {
      headers: {
        "user-agent": "<script>forged</script>",
        "x-forwarded-for": "203.0.113.42",
        "x-real-ip": "198.51.100.8",
      },
    });
    const record = activityRecordData(request, "user-1", "LOGIN");
    expect(record.description).toBe("Signed in to Keymint.");
    expect(record).not.toHaveProperty("metadata");
    expect(activityPublicSelect).not.toHaveProperty("metadata");
    expect(activityPublicSelect).not.toHaveProperty("userId");
    expect(record.ip).not.toContain("203.0.113.42");
    expect(record.ip).not.toContain("198.51.100.8");
    expect(record).toMatchObject({ browser: "Unknown", os: "Unknown", device: "Desktop" });
  });

  it("stores only a coarse network after a configured trusted-proxy chain", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const request = new Request("https://vault.example.test", {
      headers: { "x-forwarded-for": "203.0.113.42, 10.2.3.4" },
    });
    expect(activityRecordData(request, "user-1", "LOGOUT").ip).toBe("203.0.113.0/24");
  });

  it("rejects legacy unauthenticated-header envelopes on every V2 write path", () => {
    const ownerId = "user-1";
    const vaultId = "72df30a8-2cd2-4e61-93c9-c8501ca53741";
    const legacy = {
      protected: createLegacyVaultRecordProtectedHeader({
        ownerId,
        vaultId,
        recordId: "record-1",
        keyVersion: 1,
        revision: "1",
        state: "active",
      }),
      nonce: encodeBase64Url(new Uint8Array(12)),
      ciphertext: encodeBase64Url(new Uint8Array(16)),
    };
    expect(() => validateMutationRecord(legacy, ownerId, vaultId, 1)).toThrow(/routing metadata/);
    expect(() => validateSubmittedRecord(legacy, ownerId, vaultId)).toThrow(/vault/);
  });

  it("defines fixed, bounded retention windows", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(RETENTION_DAYS).toEqual({ activityLogs: 90, mutationReceipts: 7, rateLimits: 2 });
    expect(retentionCutoff(90, now).toISOString()).toBe("2026-05-04T12:00:00.000Z");
    expect(() => retentionCutoff(0, now)).toThrow(/positive integer/);
  });

  it("redacts unexpected exception messages and stacks from operational logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleApiError(new Error("password=do-not-log-this"));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("do-not-log-this");
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("do-not-log-this");
  });

  it("installs composite ownership, canonical logs, bounds, and cleanup indexes", () => {
    const migration = readFileSync(
      "prisma/migrations/20260802230000_phase13_application_security/migration.sql",
      "utf8",
    );
    expect(migration).toContain('FOREIGN KEY ("categoryId", "categoryUserId")');
    expect(migration).toContain('"categoryUserId" = "userId"');
    expect(migration).toContain('CONSTRAINT "ActivityLog_canonical_event_check"');
    expect(migration).toContain('CONSTRAINT "VaultRecord_encoding_bounds_check"');
    expect(migration).toContain('CREATE INDEX "VaultMutation_createdAt_idx"');
  });
});
