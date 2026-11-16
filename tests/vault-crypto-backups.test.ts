import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  createVaultRecordProtectedHeader,
  decryptBackup,
  encryptBackup,
  encryptVaultRecord,
  parseBackup,
  secureErase,
  serializeBackup,
  type BackupSource,
  type VaultPayload,
  type VaultRecordEnvelope,
} from "@/lib/vault-crypto";

const OWNER_ID = "user_123";
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const BACKUP_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-08-02T12:00:00.000Z";
const SOURCE: BackupSource = { keyVersion: 1, ownerId: OWNER_ID, vaultId: VAULT_ID };

/** Creates one valid encrypted source record for backup tests. */
async function sourceRecord(vaultKey: Uint8Array): Promise<VaultRecordEnvelope> {
  const payload: VaultPayload = {
    createdAt: CREATED_AT,
    id: RECORD_ID,
    payloadVersion: 1,
    revision: "1",
    type: "category",
    updatedAt: CREATED_AT,
    value: { color: "#3B82F6", icon: "folder", name: "Personal" },
  };
  return encryptVaultRecord({
    vaultKey,
    protected: createVaultRecordProtectedHeader({
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      recordId: RECORD_ID,
      keyVersion: 1,
      revision: "1",
      state: "active",
      recordType: "category",
    }),
    payload,
  });
}

describe("Vault Protocol V2 backup encryption", () => {
  it("round-trips, serializes, and fully validates a Recovery Key backup", async () => {
    const vaultKey = new Uint8Array(32).fill(21);
    const recoverySecret = new Uint8Array(32).fill(22);
    const record = await sourceRecord(vaultKey);
    const envelope = await encryptBackup({
      backupId: BACKUP_ID,
      createdAt: CREATED_AT,
      exportedAt: CREATED_AT,
      source: SOURCE,
      records: [record],
      vaultKey,
      protection: { type: "recovery-key", recoverySecret },
    });
    const serialized = serializeBackup(envelope);
    const prettySerialized = new TextEncoder().encode(
      `${JSON.stringify(JSON.parse(new TextDecoder().decode(serialized)), null, 2)}\n`,
    );
    const parsed = parseBackup(prettySerialized);
    const opened = await decryptBackup(parsed, { type: "recovery-key", recoverySecret });
    expect(opened.vaultKey).toEqual(vaultKey);
    expect(opened.archive.source).toEqual(SOURCE);
    expect(opened.archive).not.toHaveProperty("vaultKey");
    expect(opened.records).toHaveLength(1);
    expect(opened.records[0]).toMatchObject({ type: "category", id: RECORD_ID });
    secureErase(vaultKey, recoverySecret, serialized, prettySerialized, opened.vaultKey);
  });

  it("round-trips a separately salted passphrase backup", async () => {
    const vaultKey = new Uint8Array(32).fill(23);
    const record = await sourceRecord(vaultKey);
    const envelope = await encryptBackup({
      backupId: BACKUP_ID,
      createdAt: CREATED_AT,
      exportedAt: CREATED_AT,
      source: SOURCE,
      records: [record],
      vaultKey,
      protection: { type: "passphrase", passphrase: "separate backup passphrase" },
    });
    expect(envelope.protected.protection).toBe("passphrase");
    expect(envelope.protected.kdf.salt).not.toBe("");
    const opened = await decryptBackup(envelope, {
      type: "passphrase",
      passphrase: "separate backup passphrase",
    });
    expect(opened.vaultKey).toEqual(vaultKey);
    await expect(
      decryptBackup(envelope, { type: "passphrase", passphrase: "wrong backup passphrase" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(vaultKey, opened.vaultKey);
  }, 60_000);

  it("fails closed for wrong protection secrets, ciphertext tampering, and header swaps", async () => {
    const vaultKey = new Uint8Array(32).fill(24);
    const recoverySecret = new Uint8Array(32).fill(25);
    const record = await sourceRecord(vaultKey);
    const envelope = await encryptBackup({
      backupId: BACKUP_ID,
      createdAt: CREATED_AT,
      exportedAt: CREATED_AT,
      source: SOURCE,
      records: [record],
      vaultKey,
      protection: { type: "recovery-key", recoverySecret },
    });
    await expect(
      decryptBackup(envelope, { type: "recovery-key", recoverySecret: new Uint8Array(32).fill(26) }),
    ).rejects.toBeInstanceOf(AuthenticationError);

    const tamperedCiphertext = structuredClone(envelope);
    tamperedCiphertext.ciphertext = `${envelope.ciphertext.slice(0, -1)}${
      envelope.ciphertext.endsWith("A") ? "B" : "A"
    }`;
    await expect(
      decryptBackup(tamperedCiphertext, { type: "recovery-key", recoverySecret }),
    ).rejects.toThrow();

    const swappedHeader = structuredClone(envelope);
    swappedHeader.protected.createdAt = "2026-08-02T12:00:01.000Z";
    await expect(
      decryptBackup(swappedHeader, { type: "recovery-key", recoverySecret }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(vaultKey, recoverySecret);
  });

  it("rejects KDF downgrade fields before key derivation", async () => {
    const vaultKey = new Uint8Array(32).fill(27);
    const record = await sourceRecord(vaultKey);
    const envelope = await encryptBackup({
      backupId: BACKUP_ID,
      createdAt: CREATED_AT,
      exportedAt: CREATED_AT,
      source: SOURCE,
      records: [record],
      vaultKey,
      protection: { type: "passphrase", passphrase: "separate backup passphrase" },
    });
    const downgraded = structuredClone(envelope);
    if (downgraded.protected.kdf.name !== "argon2id") throw new Error("unexpected test KDF");
    downgraded.protected.kdf.memoryKiB = 8192 as 65536;
    await expect(
      decryptBackup(downgraded, { type: "passphrase", passphrase: "separate backup passphrase" }),
    ).rejects.toThrow(/profile/);
    secureErase(vaultKey);
  }, 30_000);

  it("rejects duplicate records and source substitutions during backup creation", async () => {
    const vaultKey = new Uint8Array(32).fill(28);
    const recoverySecret = new Uint8Array(32).fill(29);
    const record = await sourceRecord(vaultKey);
    await expect(
      encryptBackup({
        backupId: BACKUP_ID,
        createdAt: CREATED_AT,
        exportedAt: CREATED_AT,
        source: SOURCE,
        records: [record, record],
        vaultKey,
        protection: { type: "recovery-key", recoverySecret },
      }),
    ).rejects.toThrow(/duplicate/);
    const swapped = structuredClone(record);
    swapped.protected.ownerId = "other_user";
    if (swapped.protected.envelopeVersion === 2) swapped.protected.userId = "other_user";
    await expect(
      encryptBackup({
        backupId: BACKUP_ID,
        createdAt: CREATED_AT,
        exportedAt: CREATED_AT,
        source: SOURCE,
        records: [swapped],
        vaultKey,
        protection: { type: "recovery-key", recoverySecret },
      }),
    ).rejects.toThrow(/source/);
    secureErase(vaultKey, recoverySecret);
  });

  it("rejects malformed, duplicate-key, and invalid-Unicode backup JSON", () => {
    const encoder = new TextEncoder();
    expect(() => parseBackup(encoder.encode('{"protected":{},"protected":{},"nonce":"","ciphertext":""}'))).toThrow(
      /canonical|duplicate/,
    );
    expect(() => parseBackup(Uint8Array.from([0xff, 0xfe]))).toThrow();
    expect(() => parseBackup(encoder.encode('{ "ciphertext":"", "nonce":"", "protected":{} }'))).toThrow();
  });
});
