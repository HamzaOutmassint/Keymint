import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  canonicalizeJson,
  createHkdfKdfHeader,
  createVaultRecordProtectedHeader,
  decryptBackup,
  deriveBackupRecoveryKek,
  encryptAuthenticated,
  encryptBackup,
  encryptVaultRecord,
  encodeBase64Url,
  encodeUtf8,
  migrateBackupV1ToV2,
  parseBackup,
  secureErase,
  serializeBackup,
  type BackupArchive,
  type BackupEnvelopeV1,
  type BackupProtectedHeaderV1,
  type BackupSource,
  type VaultPayload,
  type VaultRecordEnvelope,
} from "@/lib/vault-crypto";

const OWNER_ID = "test_user";
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const BACKUP_ID = "33333333-3333-4333-8333-333333333333";
const MIGRATED_BACKUP_ID = "44444444-4444-4444-8444-444444444444";
const EXPORTED_AT = "2026-08-02T12:00:00.000Z";
const MIGRATED_AT = "2026-08-02T13:00:00.000Z";
const SOURCE: BackupSource = { keyVersion: 1, ownerId: OWNER_ID, vaultId: VAULT_ID };

async function sourceRecord(vaultKey: Uint8Array): Promise<VaultRecordEnvelope> {
  const payload: VaultPayload = {
    createdAt: EXPORTED_AT,
    id: RECORD_ID,
    payloadVersion: 1,
    revision: "1",
    type: "category",
    updatedAt: EXPORTED_AT,
    value: { color: "#3B82F6", icon: "folder", name: "Personal" },
  };
  return encryptVaultRecord({
    vaultKey,
    protected: createVaultRecordProtectedHeader({
      keyVersion: 1,
      ownerId: OWNER_ID,
      recordId: RECORD_ID,
      recordType: "category",
      revision: "1",
      state: "active",
      vaultId: VAULT_ID,
    }),
    payload,
  });
}

async function authenticatedBackupV1(
  vaultKey: Uint8Array,
  recoverySecret: Uint8Array,
  record: VaultRecordEnvelope,
): Promise<BackupEnvelopeV1> {
  const salt = new Uint8Array(16).fill(71);
  const header: BackupProtectedHeaderV1 = {
    backupId: BACKUP_ID,
    backupVersion: 1,
    cipher: "A256GCM",
    createdAt: EXPORTED_AT,
    format: "keymint-vault-backup",
    kdf: createHkdfKdfHeader(salt, "keymint/vault/v2/backup-recovery-kek"),
    protection: "recovery-key",
    protocolVersion: 2,
    purpose: "vault-backup",
  };
  const archive: BackupArchive = {
    archiveVersion: 1,
    exportedAt: EXPORTED_AT,
    records: [record],
    source: SOURCE,
    vaultKey: encodeBase64Url(vaultKey),
  };
  const kek = await deriveBackupRecoveryKek(recoverySecret, salt, BACKUP_ID);
  const plaintext = encodeUtf8(canonicalizeJson(archive));
  try {
    return await encryptAuthenticated(kek, plaintext, header);
  } finally {
    secureErase(salt, kek, plaintext);
  }
}

describe("Backup Format V2", () => {
  it("writes explicit versions and fresh salt/nonce values for every backup", async () => {
    const vaultKey = new Uint8Array(32).fill(31);
    const recoverySecret = new Uint8Array(32).fill(32);
    const record = await sourceRecord(vaultKey);
    const options = {
      backupId: BACKUP_ID,
      createdAt: EXPORTED_AT,
      exportedAt: EXPORTED_AT,
      source: SOURCE,
      records: [record],
      vaultKey,
      protection: { type: "recovery-key" as const, recoverySecret },
    };
    const first = await encryptBackup(options);
    const second = await encryptBackup(options);

    expect(first.protected).toMatchObject({
      backupVersion: 2,
      cipher: "A256GCM",
      kdfVersion: 1,
      protocolVersion: 2,
    });
    expect(first.protected.kdf.salt).not.toBe(second.protected.kdf.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(parseBackup(serializeBackup(first))).toEqual(first);
    secureErase(vaultKey, recoverySecret);
  });

  it("authenticates ciphertext and every protected AAD field", async () => {
    const vaultKey = new Uint8Array(32).fill(33);
    const recoverySecret = new Uint8Array(32).fill(34);
    const envelope = await encryptBackup({
      backupId: BACKUP_ID,
      createdAt: EXPORTED_AT,
      exportedAt: EXPORTED_AT,
      source: SOURCE,
      records: [await sourceRecord(vaultKey)],
      vaultKey,
      protection: { type: "recovery-key", recoverySecret },
    });

    const changedAad = structuredClone(envelope);
    changedAad.protected.createdAt = MIGRATED_AT;
    await expect(
      decryptBackup(changedAad, { type: "recovery-key", recoverySecret }),
    ).rejects.toBeInstanceOf(AuthenticationError);

    const changedCiphertext = structuredClone(envelope);
    changedCiphertext.ciphertext = `${changedCiphertext.ciphertext.slice(0, -1)}${
      changedCiphertext.ciphertext.endsWith("A") ? "B" : "A"
    }`;
    await expect(
      decryptBackup(changedCiphertext, { type: "recovery-key", recoverySecret }),
    ).rejects.toThrow();

    const unknownKdfVersion = structuredClone(envelope);
    unknownKdfVersion.protected.kdfVersion = 2 as 1;
    await expect(
      decryptBackup(unknownKdfVersion, { type: "recovery-key", recoverySecret }),
    ).rejects.toThrow(/KDF version/);
    secureErase(vaultKey, recoverySecret);
  });

  it("keeps authenticated `.kmvault` V1 readable and migrates it with new crypto material", async () => {
    const vaultKey = new Uint8Array(32).fill(35);
    const recoverySecret = new Uint8Array(32).fill(36);
    const v1 = await authenticatedBackupV1(vaultKey, recoverySecret, await sourceRecord(vaultKey));

    const openedV1 = await decryptBackup(v1, { type: "recovery-key", recoverySecret });
    expect(openedV1.records).toHaveLength(1);
    const v2 = await migrateBackupV1ToV2({
      backupId: MIGRATED_BACKUP_ID,
      createdAt: MIGRATED_AT,
      envelope: v1,
      protection: { type: "recovery-key", recoverySecret },
    });
    expect(v2.protected).toMatchObject({ backupVersion: 2, kdfVersion: 1 });
    expect(v2.protected.kdf.salt).not.toBe(v1.protected.kdf.salt);
    expect(v2.nonce).not.toBe(v1.nonce);
    const openedV2 = await decryptBackup(v2, { type: "recovery-key", recoverySecret });
    expect(openedV2.records).toEqual(openedV1.records);
    secureErase(vaultKey, recoverySecret, openedV1.vaultKey, openedV2.vaultKey);
  });

});
