import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  canonicalizeJson,
  constantTimeEqual,
  createMasterVaultKeyWrapper,
  createRecoveryVaultKeyWrapper,
  decodeBase64Url,
  decodeRecoveryKey,
  decryptAuthenticated,
  deriveArgon2Kek,
  deriveRecoveryKek,
  encodeBase64Url,
  encodePassphrase,
  encodeRecoveryKey,
  generateVaultKey,
  openMasterVaultKeyWrapper,
  openRecoveryVaultKeyWrapper,
  parseCanonicalJson,
  secureErase,
} from "@/lib/vault-crypto";

const OWNER_ID = "user_123";
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const MASTER_PASSWORD = "correct horse battery staple";

/** Converts bytes to lowercase hexadecimal for fixed conformance vectors. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Vault Protocol V2 encoding and derivation", () => {
  it("matches an independent Argon2id v1.3 fixed vector", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const key = await deriveArgon2Kek(MASTER_PASSWORD, salt);
    expect(hex(key)).toBe("0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e");
    secureErase(key);
  }, 30_000);

  it("normalizes passphrases to NFC without trimming", () => {
    const decomposed = encodePassphrase("e\u0301abcdefghijk");
    const composed = encodePassphrase("éabcdefghijk");
    expect(decomposed).toEqual(composed);
    expect(() => encodePassphrase(" too short ")).toThrow(/12/);
    expect(() => encodePassphrase("abcdefghijkl\ud800")).toThrow(/surrogate/);
    secureErase(decomposed, composed);
  });

  it("matches the purpose-bound recovery HKDF vector", async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const salt = Uint8Array.from({ length: 16 }, (_, index) => 255 - index);
    const key = await deriveRecoveryKek(secret, salt, OWNER_ID, VAULT_ID, 1);
    expect(hex(key)).toBe("e719055baa7f88b1b68150f47ea37cfe096ddf6f27b35ef982b394671857c65a");
    secureErase(secret, salt, key);
  });

  it("uses canonical RFC 8785 number and object serialization", () => {
    expect(canonicalizeJson({ z: 1, a: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27] })).toBe(
      '{"a":[333333333.3333333,1e+30,4.5,0.002,1e-27],"z":1}',
    );
    expect(() => parseCanonicalJson(new TextEncoder().encode('{"a":1,"a":1}'), 100)).toThrow(
      /canonical|duplicate/,
    );
  });

  it("strictly rejects noncanonical Base64url", () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(decodeBase64Url("-_8")).toEqual(new Uint8Array([0xfb, 0xff]));
    for (const invalid of ["+/8=", "-_8=", " -_8", "A", "AB"]) {
      expect(() => decodeBase64Url(invalid)).toThrow();
    }
  });

  it("matches the Recovery Key Base32/checksum vector and ignores only spaces/hyphens", async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const formatted = await encodeRecoveryKey(secret);
    expect(formatted).toBe(
      "KMV2-RK-AAAQE-AYEAU-DAOCA-JBIFQ-YDIOB-4IBCE-QTCQK-RMFYY-DENBW-HA5DY-P5ALF-QJU",
    );
    const decoded = await decodeRecoveryKey(formatted.toLowerCase().replaceAll("-", " "));
    expect(decoded).toEqual(secret);
    await expect(decodeRecoveryKey(`${formatted.slice(0, -1)}A`)).rejects.toBeInstanceOf(AuthenticationError);
    secureErase(secret, decoded);
  });

  it("generates independent 256-bit Vault Keys and erases exact buffer views", () => {
    const first = generateVaultKey();
    const second = generateVaultKey();
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    const backing = new Uint8Array([1, 2, 3, 4, 5]);
    secureErase(backing.subarray(1, 4));
    expect(backing).toEqual(new Uint8Array([1, 0, 0, 0, 5]));
    secureErase(first, second, backing);
  });

  it("compares bytes without accepting length mismatches", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });
});

describe("Vault Protocol V2 authenticated encryption", () => {
  it("decrypts an independent AES-256-GCM vector with canonical AAD", async () => {
    const plaintext = await decryptAuthenticated(new Uint8Array(32), {
      protected: {},
      nonce: "AAAAAAAAAAAAAAAA",
      ciphertext: "zqdAPU1ga24HTsXTuvOdGPwKWKgKamwNIyjQAT34Gas",
    });
    expect(plaintext).toEqual(new Uint8Array(16));
    secureErase(plaintext);
  });

  it("creates master and recovery wrappers over the same Vault Key", async () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const recoverySecret = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const master = await createMasterVaultKeyWrapper({
      vaultKey,
      masterPassword: MASTER_PASSWORD,
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      keyVersion: 1,
      wrapRevision: "1",
    });
    const recovery = await createRecoveryVaultKeyWrapper({
      vaultKey,
      recoverySecret,
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      keyVersion: 1,
      wrapRevision: "1",
    });
    expect(decodeBase64Url(master.nonce)).toHaveLength(12);
    expect(decodeBase64Url(master.ciphertext)).toHaveLength(48);
    expect(master.nonce).not.toBe(recovery.nonce);
    const fromMaster = await openMasterVaultKeyWrapper(MASTER_PASSWORD, master);
    const fromRecovery = await openRecoveryVaultKeyWrapper(recoverySecret, recovery);
    expect(fromMaster).toEqual(vaultKey);
    expect(fromRecovery).toEqual(vaultKey);
    await expect(openMasterVaultKeyWrapper("wrong password still long", master)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    secureErase(vaultKey, recoverySecret, fromMaster, fromRecovery);
  }, 60_000);

  it("rejects wrapper header substitution before returning key bytes", async () => {
    const vaultKey = new Uint8Array(32).fill(7);
    const recoverySecret = new Uint8Array(32).fill(9);
    const wrapper = await createRecoveryVaultKeyWrapper({
      vaultKey,
      recoverySecret,
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      keyVersion: 1,
      wrapRevision: "1",
    });
    const swapped = structuredClone(wrapper);
    swapped.protected.ownerId = "another_user";
    await expect(openRecoveryVaultKeyWrapper(recoverySecret, swapped)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    secureErase(vaultKey, recoverySecret);
  });
});
