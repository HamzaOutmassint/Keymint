import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createVaultRecordProtectedHeader,
  decryptBackup,
  decryptVaultRecord,
  encryptBackup,
  encryptVaultRecord,
  MAX_RECOVERY_CODES,
  secureErase,
  type VaultPayload,
} from "@/lib/vault-crypto";

const OWNER_ID = "user_123";
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const AT = "2026-11-17T12:00:00.000Z";

function payload(recoveryCodes?: unknown): VaultPayload {
  const value: Record<string, unknown> = {
    categoryId: null, email: "", favorite: false, lastViewedAt: null, name: "GitHub", notes: "",
    password: "secret", passwordUpdatedAt: AT, username: "alice", website: "https://github.com",
  };
  if (recoveryCodes !== undefined) value.recoveryCodes = recoveryCodes;
  return {
    createdAt: AT, id: RECORD_ID, payloadVersion: 1, revision: "1",
    type: "credential", updatedAt: AT, value,
  } as VaultPayload;
}

function header() {
  return createVaultRecordProtectedHeader({
    ownerId: OWNER_ID, vaultId: VAULT_ID, recordId: RECORD_ID, keyVersion: 1,
    revision: "1", state: "active", recordType: "credential",
  });
}

const validSet = {
  codes: [{ code: "a1b2c-3d4e5", usedAt: null }, { code: "1234 5678", usedAt: AT }],
  updatedAt: AT,
};

describe("credential recovery codes in encrypted records", () => {
  it("still accepts credentials written before the field existed", async () => {
    const vaultKey = new Uint8Array(32).fill(41);
    const envelope = await encryptVaultRecord({ vaultKey, protected: header(), payload: payload() });
    const decrypted = await decryptVaultRecord(vaultKey, envelope);
    expect(decrypted.type === "credential" && "recoveryCodes" in decrypted.value).toBe(false);
    secureErase(vaultKey);
  });

  it("round-trips a valid code set", async () => {
    const vaultKey = new Uint8Array(32).fill(42);
    const original = payload(validSet);
    const envelope = await encryptVaultRecord({ vaultKey, protected: header(), payload: original });
    expect(envelope.ciphertext).not.toContain("a1b2c");
    expect(await decryptVaultRecord(vaultKey, envelope)).toEqual(original);
    secureErase(vaultKey);
  });

  it.each([
    ["null", null],
    ["unknown set key", { ...validSet, source: "github.txt" }],
    ["missing updatedAt", { codes: validSet.codes }],
    ["empty list", { codes: [], updatedAt: AT }],
    ["too many codes", { codes: Array.from({ length: MAX_RECOVERY_CODES + 1 }, (_, i) => ({ code: `code-${i}`, usedAt: null })), updatedAt: AT }],
    ["unknown code key", { codes: [{ code: "a1b2c-3d4e5", usedAt: null, note: "x" }], updatedAt: AT }],
    ["empty code", { codes: [{ code: "", usedAt: null }], updatedAt: AT }],
    ["untrimmed code", { codes: [{ code: " a1b2c ", usedAt: null }], updatedAt: AT }],
    ["control character", { codes: [{ code: "a1b2\nc3d4", usedAt: null }], updatedAt: AT }],
    ["over-long code", { codes: [{ code: "x".repeat(129), usedAt: null }], updatedAt: AT }],
    ["duplicate codes", { codes: [{ code: "abcd 1234", usedAt: null }, { code: "ABCD1234", usedAt: null }], updatedAt: AT }],
    ["invalid usedAt", { codes: [{ code: "a1b2c-3d4e5", usedAt: "yesterday" }], updatedAt: AT }],
  ])("rejects %s", async (_label, recoveryCodes) => {
    const vaultKey = new Uint8Array(32).fill(43);
    await expect(encryptVaultRecord({ vaultKey, protected: header(), payload: payload(recoveryCodes) })).rejects.toThrow();
    secureErase(vaultKey);
  });

  it("survives an encrypted .kmvault backup round trip", async () => {
    const vaultKey = new Uint8Array(32).fill(44);
    const recoverySecret = new Uint8Array(32).fill(45);
    const original = payload(validSet);
    const record = await encryptVaultRecord({ vaultKey, protected: header(), payload: original });
    const backup = await encryptBackup({
      backupId: "33333333-3333-4333-8333-333333333333",
      createdAt: AT,
      exportedAt: AT,
      source: { keyVersion: 1, ownerId: OWNER_ID, vaultId: VAULT_ID },
      records: [record],
      vaultKey,
      protection: { type: "recovery-key", recoverySecret },
    });
    const opened = await decryptBackup(backup, { type: "recovery-key", recoverySecret });
    expect(opened.records).toEqual([original]);
    expect(await decryptVaultRecord(opened.vaultKey, opened.archive.records[0])).toEqual(original);
    secureErase(vaultKey, recoverySecret, opened.vaultKey);
  });
});

describe("recovery code activity events", () => {
  const migration = readFileSync("prisma/migrations/20261117120000_recovery_code_activity/migration.sql", "utf8");
  const activity = readFileSync("server/activity.ts", "utf8");
  const route = readFileSync("app/api/logs/event/route.ts", "utf8");

  it("keeps every server action and description in the latest database constraint", () => {
    const pairs = [...activity.matchAll(/^\s+([A-Z_]+): "([^"]+)",$/gm)].map(([, action, description]) => [action, description]);
    expect(pairs.length).toBeGreaterThan(10);
    for (const [action, description] of pairs) {
      expect(migration).toContain(`WHEN '${action}' THEN '${description}'`);
    }
  });

  it("lets the client log the two recovery code events", () => {
    for (const action of ["RECOVERY_CODES_VIEWED", "RECOVERY_CODE_COPIED"]) {
      expect(route).toContain(`"${action}"`);
      expect(migration).toContain(`'${action}'`);
    }
  });
});
