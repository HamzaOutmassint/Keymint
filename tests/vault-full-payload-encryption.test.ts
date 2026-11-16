import { beforeAll, describe, expect, it } from "vitest";
import {
  createMasterVaultKeyWrapper,
  createVaultUnlockMaterial,
  generateVaultKey,
  secureErase,
  type CredentialValueV1,
  type VaultPayloadBase,
} from "@/lib/vault-crypto";
import { VaultCryptoRuntime } from "@/features/vault/crypto-runtime";

const ownerId = "test_owner";
const vaultId = "58c8a881-2a5a-49a7-9f12-a0e3b9c16b3a";
const masterPassword = "Complete payload encryption test";
const now = "2026-08-02T12:00:00.000Z";
let material: ReturnType<typeof createVaultUnlockMaterial>;

beforeAll(async () => {
  const vaultKey = generateVaultKey();
  try {
    material = createVaultUnlockMaterial(await createMasterVaultKeyWrapper({
      vaultKey, masterPassword, ownerId, vaultId, keyVersion: 1, wrapRevision: "1",
    }));
  } finally {
    secureErase(vaultKey);
  }
}, 30_000);

function credentialValue(): CredentialValueV1 {
  return {
    categoryId: "private-folder", email: "alice@example.test", favorite: true,
    lastViewedAt: null, name: "Private Bank", notes: "secret recovery note",
    password: "correct horse battery staple", passwordUpdatedAt: now,
    username: "alice", website: "https://private.example.test",
  };
}

describe("complete encrypted payload runtime", () => {
  it("stores no credential metadata outside authenticated ciphertext", async () => {
    const runtime = new VaultCryptoRuntime();
    await runtime.unlock(material, masterPassword);
    const encrypted = await runtime.encryptRecord({ type: "credential", value: credentialValue(), now });
    const serialized = JSON.stringify(encrypted.envelope);

    for (const plaintext of ["Private Bank", "alice@example.test", "private.example.test", "secret recovery note", "correct horse"]) {
      expect(serialized).not.toContain(plaintext);
    }
    expect(Object.keys(encrypted.envelope.protected).sort()).toEqual([
      "application", "cipher", "encryptionVersion", "envelopeVersion", "format", "keyVersion",
      "ownerId", "payloadVersion", "protocolVersion", "purpose", "recordId", "recordType",
      "revision", "state", "userId", "vaultId",
    ]);
    const [opened] = await runtime.decryptRecords([encrypted.envelope]);
    expect(opened).toEqual(encrypted.payload);
    runtime.lock();
  }, 30_000);

  it("increments versioned revisions and emits encrypted tombstones", async () => {
    const runtime = new VaultCryptoRuntime();
    await runtime.unlock(material, masterPassword);
    const first = await runtime.encryptRecord({ id: "credential-test", type: "credential", value: credentialValue(), now });
    const second = await runtime.encryptRecord({
      current: first.payload,
      type: "credential",
      value: { ...credentialValue(), name: "Renamed privately" },
      now: "2026-08-02T12:01:00.000Z",
    });
    expect(second.payload.revision).toBe("2");
    expect(second.payload.payloadVersion).toBe(1);
    const tombstone = await runtime.deleteRecord(second.payload as VaultPayloadBase, "2026-08-02T12:02:00.000Z");
    expect(tombstone.protected).toMatchObject({ revision: "3", state: "deleted" });
    await expect(runtime.decryptRecords([tombstone])).resolves.toEqual([
      { deletedAt: "2026-08-02T12:02:00.000Z", id: "credential-test", payloadVersion: 1, revision: "3", type: "tombstone" },
    ]);
    runtime.lock();
  }, 30_000);
});
