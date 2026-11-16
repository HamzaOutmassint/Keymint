import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  createVaultRecordProtectedHeader,
  decodeBase64Url,
  decryptVaultRecord,
  encodeBase64Url,
  encryptVaultRecord,
  secureErase,
  type VaultPayload,
  type VaultPayloadBase,
} from "@/lib/vault-crypto";

const OWNER_ID = "user_123";
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-08-02T12:00:00.000Z";

/** Creates a complete valid credential payload for record tests. */
function credentialPayload(revision = "1"): VaultPayload {
  return {
    createdAt: CREATED_AT,
    id: RECORD_ID,
    payloadVersion: 1,
    revision,
    type: "credential",
    updatedAt: CREATED_AT,
    value: {
      categoryId: null,
      email: "alice@example.test",
      favorite: true,
      lastViewedAt: null,
      name: "Example",
      notes: "preserved exactly",
      password: " secret ",
      passwordUpdatedAt: CREATED_AT,
      username: "alice",
      website: "https://example.test",
    },
  };
}

/** Creates the protected header corresponding to a test record. */
function activeHeader(revision = "1") {
  return createVaultRecordProtectedHeader({
    ownerId: OWNER_ID,
    vaultId: VAULT_ID,
    recordId: RECORD_ID,
    keyVersion: 1,
    revision,
    state: "active",
    recordType: "credential",
  });
}

describe("Vault Protocol V2 record encryption", () => {
  it("round-trips a complete record while preserving semantic strings", async () => {
    const vaultKey = new Uint8Array(32).fill(11);
    const payload = credentialPayload();
    const envelope = await encryptVaultRecord({ vaultKey, protected: activeHeader(), payload });
    const decrypted = await decryptVaultRecord(vaultKey, envelope);
    expect(decrypted).toEqual(payload);
    expect(decrypted.type === "credential" && decrypted.value.password).toBe(" secret ");
    secureErase(vaultKey);
  });

  it("uses a new 96-bit nonce for every encryption", async () => {
    const vaultKey = new Uint8Array(32).fill(12);
    const first = await encryptVaultRecord({ vaultKey, protected: activeHeader(), payload: credentialPayload() });
    const second = await encryptVaultRecord({ vaultKey, protected: activeHeader(), payload: credentialPayload() });
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    secureErase(vaultKey);
  });

  it("rejects ciphertext and tag tampering", async () => {
    const vaultKey = new Uint8Array(32).fill(13);
    const envelope = await encryptVaultRecord({ vaultKey, protected: activeHeader(), payload: credentialPayload() });
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    ciphertext[ciphertext.length - 1] ^= 1;
    const tampered = { ...envelope, ciphertext: encodeBase64Url(ciphertext) };
    await expect(decryptVaultRecord(vaultKey, tampered)).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(vaultKey, ciphertext);
  });

  it.each([
    ["vaultId", "33333333-3333-4333-8333-333333333333"],
    ["recordId", "44444444-4444-4444-8444-444444444444"],
    ["revision", "2"],
    ["keyVersion", 2],
  ] as const)("authenticates protected %s binding", async (field, replacement) => {
    const vaultKey = new Uint8Array(32).fill(14);
    const envelope = await encryptVaultRecord({ vaultKey, protected: activeHeader(), payload: credentialPayload() });
    const swapped = structuredClone(envelope);
    Object.assign(swapped.protected, { [field]: replacement });
    await expect(decryptVaultRecord(vaultKey, swapped)).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(vaultKey);
  });

  it("round-trips an authenticated tombstone", async () => {
    const vaultKey = new Uint8Array(32).fill(15);
    const header = createVaultRecordProtectedHeader({
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      recordId: RECORD_ID,
      keyVersion: 1,
      revision: "2",
      state: "deleted",
      recordType: "tombstone",
    });
    const payload: VaultPayload = {
      deletedAt: CREATED_AT,
      id: RECORD_ID,
      payloadVersion: 1,
      revision: "2",
      type: "tombstone",
    };
    const envelope = await encryptVaultRecord({ vaultKey, protected: header, payload });
    await expect(decryptVaultRecord(vaultKey, envelope)).resolves.toEqual(payload);
    secureErase(vaultKey);
  });

  it("rejects payload/header mismatches before encryption", async () => {
    const vaultKey = new Uint8Array(32).fill(16);
    const wrongId = credentialPayload() as VaultPayloadBase;
    wrongId.id = "55555555-5555-4555-8555-555555555555";
    await expect(encryptVaultRecord({ vaultKey, protected: activeHeader(), payload: wrongId })).rejects.toThrow(
      /does not match/,
    );
    secureErase(vaultKey);
  });

  it("rejects unknown payload fields and unknown protocol versions", async () => {
    const vaultKey = new Uint8Array(32).fill(17);
    const payload = credentialPayload() as VaultPayload & { leaked?: string };
    payload.leaked = "must not be accepted";
    await expect(encryptVaultRecord({ vaultKey, protected: activeHeader(), payload })).rejects.toThrow(
      /missing or unknown/,
    );

    const header = { ...activeHeader(), protocolVersion: 3 as 2 };
    await expect(encryptVaultRecord({ vaultKey, protected: header, payload: credentialPayload() })).rejects.toThrow(
      /version/,
    );
    secureErase(vaultKey);
  });

  it("enforces the canonical plaintext size ceiling", async () => {
    const vaultKey = new Uint8Array(32).fill(18);
    const payload = credentialPayload() as VaultPayloadBase;
    payload.value.notes = "x".repeat(10_001);
    await expect(encryptVaultRecord({ vaultKey, protected: activeHeader(), payload })).rejects.toThrow(/notes/);
    secureErase(vaultKey);
  });
});
