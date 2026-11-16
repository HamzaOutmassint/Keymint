import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  canonicalizeVaultRecordAad,
  createLegacyVaultRecordProtectedHeader,
  createMasterVaultKeyWrapper,
  createVaultRecordProtectedHeader,
  createVaultUnlockMaterial,
  decryptVaultRecord,
  encodeVaultRecordAad,
  encryptVaultRecord,
  generateVaultKey,
  secureErase,
  type VaultPayload,
  type VaultRecordProtectedHeader,
} from "@/lib/vault-crypto";
import { VaultCryptoRuntime } from "@/features/vault/crypto-runtime";

const OWNER_ID = "test-user";
const OTHER_OWNER = "test-attacker";
const VAULT_ID = "b4b98580-f5c8-4f6a-a971-d6eac3486270";
const RECORD_ID = "test-record";
const OTHER_RECORD_ID = "test-other-record";
const CREATED_AT = "2026-08-02T15:00:00.000Z";
const MASTER_PASSWORD = "Authenticated Metadata Password";

function payload(revision = "1"): VaultPayload {
  return {
    createdAt: CREATED_AT,
    id: RECORD_ID,
    payloadVersion: 1,
    revision,
    type: "credential",
    updatedAt: CREATED_AT,
    value: {
      categoryId: null,
      email: "test@example.test",
      favorite: false,
      lastViewedAt: null,
      name: "Authenticated metadata",
      notes: "",
      password: "secret",
      passwordUpdatedAt: CREATED_AT,
      username: "test-user",
      website: "",
    },
  };
}

function aad() {
  return createVaultRecordProtectedHeader({
    ownerId: OWNER_ID,
    vaultId: VAULT_ID,
    recordId: RECORD_ID,
    keyVersion: 1,
    revision: "1",
    state: "active",
    recordType: "credential",
  });
}

describe("canonical authenticated metadata", () => {
  it("includes every required binding in deterministic RFC 8785 UTF-8", () => {
    const header = aad();
    expect(header).toMatchObject({
      application: "Keymint",
      userId: OWNER_ID,
      recordId: RECORD_ID,
      recordType: "credential",
      encryptionVersion: 2,
      payloadVersion: 1,
    });
    const reordered = Object.fromEntries(Object.entries(header).reverse()) as unknown as VaultRecordProtectedHeader;
    expect(canonicalizeVaultRecordAad(reordered)).toBe(canonicalizeVaultRecordAad(header));
    expect(new TextDecoder().decode(encodeVaultRecordAad(header))).toBe(canonicalizeVaultRecordAad(header));
  });

  it.each([
    ["user id", (header: ReturnType<typeof aad>) => { header.ownerId = OTHER_OWNER; header.userId = OTHER_OWNER; }],
    ["record id", (header: ReturnType<typeof aad>) => { header.recordId = OTHER_RECORD_ID; }],
    ["record type", (header: ReturnType<typeof aad>) => { header.recordType = "category"; }],
  ] as const)("fails AES-GCM authentication when %s changes", async (_label, mutate) => {
    const vaultKey = generateVaultKey();
    const envelope = await encryptVaultRecord({ vaultKey, protected: aad(), payload: payload() });
    const tampered = structuredClone(envelope);
    if (tampered.protected.envelopeVersion !== 2) throw new Error("Expected AAD v2 fixture");
    mutate(tampered.protected);
    await expect(decryptVaultRecord(vaultKey, tampered)).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(vaultKey);
  });

  it("fails closed when the encryption version changes", async () => {
    const vaultKey = generateVaultKey();
    const envelope = await encryptVaultRecord({ vaultKey, protected: aad(), payload: payload() });
    const tampered = structuredClone(envelope);
    if (tampered.protected.envelopeVersion !== 2) throw new Error("Expected AAD v2 fixture");
    tampered.protected.encryptionVersion = 3 as 2;
    await expect(decryptVaultRecord(vaultKey, tampered)).rejects.toThrow(/encryption version/);
    secureErase(vaultKey);
  });

  it("decrypts legacy AAD v1 and migrates it to canonical AAD v2", async () => {
    const vaultKey = generateVaultKey();
    const legacy = await encryptVaultRecord({
      vaultKey,
      protected: createLegacyVaultRecordProtectedHeader({
        ownerId: OWNER_ID, vaultId: VAULT_ID, recordId: RECORD_ID,
        keyVersion: 1, revision: "1", state: "active",
      }),
      payload: payload(),
    });
    await expect(decryptVaultRecord(vaultKey, legacy)).resolves.toEqual(payload());
    const material = createVaultUnlockMaterial(await createMasterVaultKeyWrapper({
      vaultKey, masterPassword: MASTER_PASSWORD, ownerId: OWNER_ID,
      vaultId: VAULT_ID, keyVersion: 1, wrapRevision: "1",
    }));
    const runtime = new VaultCryptoRuntime();
    await runtime.unlock(material, MASTER_PASSWORD);
    const [migrated] = await runtime.upgradeRecordEnvelopes([legacy]);
    expect(migrated.expectedRevision).toBe("1");
    expect(migrated.envelope.protected).toMatchObject({
      envelopeVersion: 2, encryptionVersion: 2, recordType: "credential", revision: "2",
    });
    await expect(runtime.decryptRecords([migrated.envelope])).resolves.toEqual([
      { ...payload(), revision: "2" },
    ]);
    runtime.lock();
    secureErase(vaultKey);
  }, 30_000);
});
