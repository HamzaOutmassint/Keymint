import { argon2id } from "hash-wasm";

import {
  assertExactKeys,
  assertIdentifier,
  assertJsonValue,
  assertKeyVersion,
  assertRevision,
  assertUuidV4,
  canonicalizeJson,
  decodeBase32,
  decodeBase64Url,
  encodeBase32,
  encodeBase64Url,
  encodeUtf8,
  hasUnpairedSurrogate,
} from "./encoding";
import type {
  Argon2KdfHeader,
  AuthenticatedEnvelope,
  CreateMasterWrapperOptions,
  CreateRecoveryWrapperOptions,
  HkdfKdfHeader,
  JsonObject,
  VaultKeyProtectedHeader,
  WrappedVaultKeyEnvelope,
} from "./types";

export const MASTER_KDF_PROFILE = "KM-ARGON2ID-64M-3T-1P-V1" as const;
export const ARGON2_MEMORY_KIB = 65536 as const;
export const ARGON2_ITERATIONS = 3 as const;
export const ARGON2_PARALLELISM = 1 as const;
export const KEY_BYTES = 32 as const;
export const SALT_BYTES = 16 as const;
export const NONCE_BYTES = 12 as const;
export const TAG_BYTES = 16 as const;

/** A fail-closed error for authentication failures that reveals no secret-derived detail. */
export class AuthenticationError extends Error {
  /** Creates a generic authentication error suitable for local presentation. */
  constructor() {
    super("The key is incorrect or the authenticated data is damaged");
    this.name = "AuthenticationError";
  }
}

/** Returns the browser Web Crypto implementation or fails before using secrets. */
function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Web Crypto is unavailable");
  }
  return globalThis.crypto;
}

/** Creates an isolated ArrayBuffer copy accepted consistently by Web Crypto runtimes. */
function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Concatenates byte arrays without converting secret material to strings. */
function concatenateBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Encodes a key version as an unsigned four-byte big-endian integer. */
function encodeU32(value: number): Uint8Array {
  assertKeyVersion(value);
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

/** Validates that a secret key has the protocol-required byte length. */
function assertKey(key: Uint8Array, name: string): void {
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new TypeError(`${name} must contain exactly 32 bytes`);
  }
}

/** Generates unpredictable bytes using the browser CSPRNG. */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 65536) {
    throw new RangeError("Random byte length must be between 1 and 65536");
  }
  return webCrypto().getRandomValues(new Uint8Array(length));
}

/** Best-effort overwrites each supplied buffer view without releasing its references. */
export function secureErase(
  ...buffers: Array<ArrayBuffer | ArrayBufferView | null | undefined>
): void {
  for (const buffer of buffers) {
    if (!buffer) continue;
    if (ArrayBuffer.isView(buffer)) {
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0);
    } else {
      new Uint8Array(buffer).fill(0);
    }
  }
}

/** Compares equal-length byte arrays without data-dependent early return. */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** Normalizes and bounds a V2 Master Password or backup passphrase as UTF-8 NFC bytes. */
export function encodePassphrase(passphrase: string): Uint8Array {
  if (typeof passphrase !== "string") throw new TypeError("Passphrase must be a string");
  if (hasUnpairedSurrogate(passphrase)) {
    throw new TypeError("Passphrase contains an unpaired Unicode surrogate");
  }
  const normalized = passphrase.normalize("NFC");
  const scalarCount = Array.from(normalized).length;
  if (scalarCount < 12 || scalarCount > 256) {
    throw new RangeError("Passphrase must contain between 12 and 256 Unicode scalars");
  }
  const bytes = encodeUtf8(normalized);
  if (bytes.byteLength > 1024) {
    secureErase(bytes);
    throw new RangeError("Passphrase UTF-8 encoding exceeds 1024 bytes");
  }
  return bytes;
}

/** Derives a 32-byte Argon2id KEK using the immutable V2 live profile. */
export async function deriveArgon2Kek(
  passphrase: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (!(salt instanceof Uint8Array) || salt.byteLength !== SALT_BYTES) {
    throw new TypeError("Argon2id salt must contain exactly 16 bytes");
  }
  const passwordBytes = encodePassphrase(passphrase);
  try {
    return await argon2id({
      password: passwordBytes,
      salt,
      iterations: ARGON2_ITERATIONS,
      parallelism: ARGON2_PARALLELISM,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: KEY_BYTES,
      outputType: "binary",
    });
  } finally {
    secureErase(passwordBytes);
  }
}

/** Derives a Master Password KEK for a live V2 Vault Key wrapper. */
export async function deriveMasterKek(
  masterPassword: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return deriveArgon2Kek(masterPassword, salt);
}

/** Derives a passphrase backup KEK using an independent Argon2id salt. */
export async function deriveBackupPassphraseKek(
  passphrase: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return deriveArgon2Kek(passphrase, salt);
}

/** Derives 32 bytes with HKDF-SHA-256 and purpose-bound info. */
async function deriveHkdf(
  secret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
): Promise<Uint8Array> {
  assertKey(secret, "HKDF input secret");
  if (!(salt instanceof Uint8Array) || salt.byteLength !== SALT_BYTES) {
    throw new TypeError("HKDF salt must contain exactly 16 bytes");
  }
  const crypto = webCrypto();
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBufferCopy(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: arrayBufferCopy(salt),
      info: arrayBufferCopy(info),
    },
    key,
    256,
  );
  return new Uint8Array(result);
}

/** Derives the recovery-wrapper KEK bound to owner, vault, and key version. */
export async function deriveRecoveryKek(
  recoverySecret: Uint8Array,
  salt: Uint8Array,
  ownerId: string,
  vaultId: string,
  keyVersion: number,
): Promise<Uint8Array> {
  assertIdentifier(ownerId, "ownerId");
  assertUuidV4(vaultId, "vaultId");
  assertKeyVersion(keyVersion);
  const zero = new Uint8Array([0]);
  const info = concatenateBytes(
    encodeUtf8("keymint/vault/v2/recovery-kek"),
    zero,
    encodeUtf8(ownerId),
    zero,
    encodeUtf8(vaultId),
    zero,
    encodeU32(keyVersion),
  );
  try {
    return await deriveHkdf(recoverySecret, salt, info);
  } finally {
    secureErase(info);
  }
}

/** Derives a Recovery Key backup KEK bound to the authenticated backup ID. */
export async function deriveBackupRecoveryKek(
  recoverySecret: Uint8Array,
  salt: Uint8Array,
  backupId: string,
): Promise<Uint8Array> {
  assertUuidV4(backupId, "backupId");
  const info = concatenateBytes(
    encodeUtf8("keymint/vault/v2/backup-recovery-kek"),
    new Uint8Array([0]),
    encodeUtf8(backupId),
  );
  try {
    return await deriveHkdf(recoverySecret, salt, info);
  } finally {
    secureErase(info);
  }
}

/** Generates a new random 256-bit Vault Key / DEK. */
export function generateVaultKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/** Calculates SHA-256 over bytes using Web Crypto. */
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await webCrypto().subtle.digest("SHA-256", arrayBufferCopy(bytes)));
}

/** Formats a raw Recovery Key secret with its domain-separated checksum. */
export async function encodeRecoveryKey(recoverySecret: Uint8Array): Promise<string> {
  assertKey(recoverySecret, "Recovery Key secret");
  const checksumInput = concatenateBytes(
    encodeUtf8("keymint/vault/v2/recovery-key-checksum"),
    new Uint8Array([0]),
    recoverySecret,
  );
  const digest = await sha256(checksumInput);
  const payload = concatenateBytes(recoverySecret, digest.subarray(0, 4));
  try {
    const encoded = encodeBase32(payload);
    return `KMV2-RK-${encoded.match(/.{1,5}/g)?.join("-") ?? ""}`;
  } finally {
    secureErase(checksumInput, digest, payload);
  }
}

/** Generates a random Recovery Key and its one-time human representation. */
export async function generateRecoveryKey(): Promise<{
  recoverySecret: Uint8Array;
  formatted: string;
}> {
  const recoverySecret = randomBytes(KEY_BYTES);
  try {
    return { recoverySecret, formatted: await encodeRecoveryKey(recoverySecret) };
  } catch (error) {
    secureErase(recoverySecret);
    throw error;
  }
}

/** Decodes, canonicalizes, and checksum-validates a human Recovery Key. */
export async function decodeRecoveryKey(value: string): Promise<Uint8Array> {
  if (typeof value !== "string") throw new TypeError("Recovery Key must be a string");
  const normalized = value.toUpperCase().replace(/[ -]/g, "");
  if (!normalized.startsWith("KMV2RK") || normalized.length !== 6 + 58) {
    throw new TypeError("Recovery Key has an invalid prefix or length");
  }
  const payload = decodeBase32(normalized.slice(6));
  if (payload.byteLength !== 36) {
    secureErase(payload);
    throw new TypeError("Recovery Key payload must contain 36 bytes");
  }
  const secret = payload.slice(0, 32);
  const expectedText = await encodeRecoveryKey(secret);
  const actualText = `KMV2-RK-${normalized.slice(6).match(/.{1,5}/g)?.join("-") ?? ""}`;
  if (expectedText !== actualText) {
    secureErase(payload, secret);
    throw new AuthenticationError();
  }
  secureErase(payload);
  return secret;
}

/** Encrypts bytes with AES-256-GCM, a fresh nonce, and canonical protected-header AAD. */
export async function encryptAuthenticated<TProtected extends JsonObject>(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  protectedHeader: TProtected,
  encodedAdditionalData?: Uint8Array,
): Promise<AuthenticatedEnvelope<TProtected>> {
  assertKey(keyBytes, "AES key");
  if (!(plaintext instanceof Uint8Array)) throw new TypeError("Plaintext must be bytes");
  assertJsonValue(protectedHeader);
  const aad = encodedAdditionalData
    ? new Uint8Array(encodedAdditionalData)
    : encodeUtf8(canonicalizeJson(protectedHeader));
  const nonce = randomBytes(NONCE_BYTES);
  try {
    const key = await webCrypto().subtle.importKey(
      "raw",
      arrayBufferCopy(keyBytes),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ciphertext = await webCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: arrayBufferCopy(nonce),
        additionalData: arrayBufferCopy(aad),
        tagLength: 128,
      },
      key,
      arrayBufferCopy(plaintext),
    );
    return {
      protected: protectedHeader,
      nonce: encodeBase64Url(nonce),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    };
  } finally {
    secureErase(aad, nonce);
  }
}

/** Authenticates and decrypts an AES-256-GCM envelope using exact canonical AAD. */
export async function decryptAuthenticated<TProtected extends JsonObject>(
  keyBytes: Uint8Array,
  envelope: AuthenticatedEnvelope<TProtected>,
  maximumCiphertextBytes = Number.MAX_SAFE_INTEGER,
  encodedAdditionalData?: Uint8Array,
): Promise<Uint8Array> {
  assertKey(keyBytes, "AES key");
  assertExactKeys(envelope, ["protected", "nonce", "ciphertext"], "AEAD envelope");
  assertJsonValue(envelope.protected);
  const nonce = decodeBase64Url(envelope.nonce, NONCE_BYTES);
  let ciphertext: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  try {
    if (nonce.byteLength !== NONCE_BYTES) throw new TypeError("AES-GCM nonce must contain 12 bytes");
    ciphertext = decodeBase64Url(envelope.ciphertext, maximumCiphertextBytes);
    if (ciphertext.byteLength < TAG_BYTES) {
      throw new TypeError("AES-GCM ciphertext is shorter than its authentication tag");
    }
    aad = encodedAdditionalData
      ? new Uint8Array(encodedAdditionalData)
      : encodeUtf8(canonicalizeJson(envelope.protected));
    const key = await webCrypto().subtle.importKey(
      "raw",
      arrayBufferCopy(keyBytes),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    try {
      return new Uint8Array(
        await webCrypto().subtle.decrypt(
          {
            name: "AES-GCM",
            iv: arrayBufferCopy(nonce),
            additionalData: arrayBufferCopy(aad),
            tagLength: 128,
          },
          key,
          arrayBufferCopy(ciphertext),
        ),
      );
    } catch {
      throw new AuthenticationError();
    }
  } finally {
    secureErase(nonce, ciphertext, aad);
  }
}

/** Builds the exact fixed Argon2id protected-header KDF object. */
export function createArgon2KdfHeader(salt: Uint8Array): Argon2KdfHeader {
  if (salt.byteLength !== SALT_BYTES) throw new TypeError("Argon2 salt must contain 16 bytes");
  return {
    iterations: ARGON2_ITERATIONS,
    memoryKiB: ARGON2_MEMORY_KIB,
    name: "argon2id",
    outputBytes: KEY_BYTES,
    parallelism: ARGON2_PARALLELISM,
    passwordEncoding: "UTF-8-NFC",
    profile: MASTER_KDF_PROFILE,
    salt: encodeBase64Url(salt),
    version: 19,
  };
}

/** Builds the exact protected-header HKDF object for a recovery purpose. */
export function createHkdfKdfHeader(
  salt: Uint8Array,
  infoProfile: HkdfKdfHeader["infoProfile"],
): HkdfKdfHeader {
  if (salt.byteLength !== SALT_BYTES) throw new TypeError("HKDF salt must contain 16 bytes");
  return { infoProfile, name: "HKDF-SHA-256", outputBytes: KEY_BYTES, salt: encodeBase64Url(salt) };
}

/** Strictly validates a V2 Vault Key wrapper protected header and KDF tuple. */
export function validateVaultKeyProtectedHeader(
  header: unknown,
): asserts header is VaultKeyProtectedHeader {
  assertExactKeys(
    header,
    ["cipher", "format", "kdf", "keyVersion", "ownerId", "protocolVersion", "purpose", "vaultId", "wrapRevision", "wrapVersion"],
    "wrapper protected header",
  );
  if (header.cipher !== "A256GCM" || header.format !== "keymint-wrapped-vault-key") {
    throw new TypeError("Unsupported wrapper cipher or format");
  }
  if (header.protocolVersion !== 2 || header.wrapVersion !== 1) {
    throw new TypeError("Unsupported wrapper version");
  }
  if (header.purpose !== "master" && header.purpose !== "recovery") {
    throw new TypeError("Unsupported wrapper purpose");
  }
  assertIdentifier(header.ownerId, "ownerId");
  assertUuidV4(header.vaultId, "vaultId");
  assertKeyVersion(header.keyVersion);
  assertRevision(header.wrapRevision, "wrapRevision");
  if (header.purpose === "master") {
    assertExactKeys(header.kdf, ["iterations", "memoryKiB", "name", "outputBytes", "parallelism", "passwordEncoding", "profile", "salt", "version"], "master KDF");
    if (
      header.kdf.name !== "argon2id" || header.kdf.version !== 19 ||
      header.kdf.memoryKiB !== ARGON2_MEMORY_KIB || header.kdf.iterations !== ARGON2_ITERATIONS ||
      header.kdf.parallelism !== ARGON2_PARALLELISM || header.kdf.outputBytes !== KEY_BYTES ||
      header.kdf.passwordEncoding !== "UTF-8-NFC" || header.kdf.profile !== MASTER_KDF_PROFILE
    ) throw new TypeError("Unsupported master KDF profile");
  } else {
    assertExactKeys(header.kdf, ["infoProfile", "name", "outputBytes", "salt"], "recovery KDF");
    if (
      header.kdf.name !== "HKDF-SHA-256" || header.kdf.outputBytes !== KEY_BYTES ||
      header.kdf.infoProfile !== "keymint/vault/v2/recovery-kek"
    ) throw new TypeError("Unsupported recovery KDF profile");
  }
  if (typeof header.kdf.salt !== "string") throw new TypeError("Wrapper salt must be Base64url text");
  const salt = decodeBase64Url(header.kdf.salt, SALT_BYTES);
  try {
    if (salt.byteLength !== SALT_BYTES) throw new TypeError("Wrapper salt must contain 16 bytes");
  } finally {
    secureErase(salt);
  }
}

/** Wraps exactly one 32-byte Vault Key under a purpose-appropriate 32-byte KEK. */
export async function wrapVaultKey(
  vaultKey: Uint8Array,
  kek: Uint8Array,
  protectedHeader: VaultKeyProtectedHeader,
): Promise<WrappedVaultKeyEnvelope> {
  assertKey(vaultKey, "Vault Key");
  assertKey(kek, "KEK");
  validateVaultKeyProtectedHeader(protectedHeader);
  const envelope = await encryptAuthenticated(kek, vaultKey, protectedHeader);
  const decoded = decodeBase64Url(envelope.ciphertext, KEY_BYTES + TAG_BYTES);
  if (decoded.byteLength !== KEY_BYTES + TAG_BYTES) {
    secureErase(decoded);
    throw new TypeError("Wrapped Vault Key must contain 48 ciphertext bytes");
  }
  secureErase(decoded);
  const check = await unwrapVaultKey(kek, envelope);
  try {
    if (!constantTimeEqual(check, vaultKey)) throw new AuthenticationError();
  } finally {
    secureErase(check);
  }
  return envelope;
}

/** Authenticates a wrapper and returns its exact 32-byte Vault Key. */
export async function unwrapVaultKey(
  kek: Uint8Array,
  envelope: WrappedVaultKeyEnvelope,
): Promise<Uint8Array> {
  assertKey(kek, "KEK");
  validateVaultKeyProtectedHeader(envelope.protected);
  const vaultKey = await decryptAuthenticated(kek, envelope, KEY_BYTES + TAG_BYTES);
  if (vaultKey.byteLength !== KEY_BYTES) {
    secureErase(vaultKey);
    throw new TypeError("Unwrapped Vault Key must contain exactly 32 bytes");
  }
  return vaultKey;
}

/** Creates and locally verifies a new master-password Vault Key wrapper. */
export async function createMasterVaultKeyWrapper(
  options: CreateMasterWrapperOptions,
): Promise<WrappedVaultKeyEnvelope> {
  assertKey(options.vaultKey, "Vault Key");
  const salt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | undefined;
  try {
    kek = await deriveMasterKek(options.masterPassword, salt);
    return await wrapVaultKey(options.vaultKey, kek, {
      cipher: "A256GCM",
      format: "keymint-wrapped-vault-key",
      kdf: createArgon2KdfHeader(salt),
      keyVersion: options.keyVersion,
      ownerId: options.ownerId,
      protocolVersion: 2,
      purpose: "master",
      vaultId: options.vaultId,
      wrapRevision: options.wrapRevision,
      wrapVersion: 1,
    });
  } finally {
    secureErase(salt, kek);
  }
}

/** Derives the stored master KEK and opens a master Vault Key wrapper. */
export async function openMasterVaultKeyWrapper(
  masterPassword: string,
  envelope: WrappedVaultKeyEnvelope,
): Promise<Uint8Array> {
  validateVaultKeyProtectedHeader(envelope.protected);
  if (envelope.protected.purpose !== "master") throw new TypeError("Expected a master wrapper");
  const salt = decodeBase64Url(envelope.protected.kdf.salt, SALT_BYTES);
  let kek: Uint8Array | undefined;
  try {
    kek = await deriveMasterKek(masterPassword, salt);
    return await unwrapVaultKey(kek, envelope);
  } finally {
    secureErase(salt, kek);
  }
}

/** Creates and locally verifies a Recovery Key Vault Key wrapper. */
export async function createRecoveryVaultKeyWrapper(
  options: CreateRecoveryWrapperOptions,
): Promise<WrappedVaultKeyEnvelope> {
  assertKey(options.vaultKey, "Vault Key");
  assertKey(options.recoverySecret, "Recovery Key secret");
  const salt = randomBytes(SALT_BYTES);
  let kek: Uint8Array | undefined;
  try {
    kek = await deriveRecoveryKek(
      options.recoverySecret,
      salt,
      options.ownerId,
      options.vaultId,
      options.keyVersion,
    );
    return await wrapVaultKey(options.vaultKey, kek, {
      cipher: "A256GCM",
      format: "keymint-wrapped-vault-key",
      kdf: createHkdfKdfHeader(salt, "keymint/vault/v2/recovery-kek"),
      keyVersion: options.keyVersion,
      ownerId: options.ownerId,
      protocolVersion: 2,
      purpose: "recovery",
      vaultId: options.vaultId,
      wrapRevision: options.wrapRevision,
      wrapVersion: 1,
    });
  } finally {
    secureErase(salt, kek);
  }
}

/** Derives the purpose-bound recovery KEK and opens a Recovery Key wrapper. */
export async function openRecoveryVaultKeyWrapper(
  recoverySecret: Uint8Array,
  envelope: WrappedVaultKeyEnvelope,
): Promise<Uint8Array> {
  validateVaultKeyProtectedHeader(envelope.protected);
  if (envelope.protected.purpose !== "recovery") throw new TypeError("Expected a recovery wrapper");
  const salt = decodeBase64Url(envelope.protected.kdf.salt, SALT_BYTES);
  let kek: Uint8Array | undefined;
  try {
    kek = await deriveRecoveryKek(
      recoverySecret,
      salt,
      envelope.protected.ownerId,
      envelope.protected.vaultId,
      envelope.protected.keyVersion,
    );
    return await unwrapVaultKey(kek, envelope);
  } finally {
    secureErase(salt, kek);
  }
}
