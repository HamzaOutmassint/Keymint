import { assertExactKeys, decodeBase64Url } from "./encoding";
import {
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
  openMasterVaultKeyWrapper,
  validateVaultKeyProtectedHeader,
} from "./crypto";
import type {
  Argon2KdfHeader,
  VaultUnlockMaterial,
  WrappedVaultKeyEnvelope,
} from "./types";

const KDF_KEYS = [
  "iterations",
  "memoryKiB",
  "name",
  "outputBytes",
  "parallelism",
  "passwordEncoding",
  "profile",
  "version",
] as const;

/** Validates a serialized wrapper without deriving a key or opening ciphertext. */
export function validateWrappedVaultKeyEnvelope(
  envelope: unknown,
): asserts envelope is WrappedVaultKeyEnvelope {
  assertExactKeys(envelope, ["ciphertext", "nonce", "protected"], "Vault Key wrapper");
  validateVaultKeyProtectedHeader(envelope.protected);
  if (typeof envelope.nonce !== "string" || typeof envelope.ciphertext !== "string") {
    throw new TypeError("Wrapper nonce and ciphertext must be Base64url strings");
  }
  const nonce = decodeBase64Url(envelope.nonce, NONCE_BYTES);
  const ciphertext = decodeBase64Url(envelope.ciphertext, KEY_BYTES + TAG_BYTES);
  try {
    if (nonce.byteLength !== NONCE_BYTES) throw new TypeError("Wrapper nonce must contain 12 bytes");
    if (ciphertext.byteLength !== KEY_BYTES + TAG_BYTES) {
      throw new TypeError("Wrapped Vault Key must contain 48 bytes");
    }
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
  }
}

/** Projects a stored master wrapper to the deliberately narrow unlock response. */
export function createVaultUnlockMaterial(
  envelope: WrappedVaultKeyEnvelope,
): VaultUnlockMaterial {
  validateWrappedVaultKeyEnvelope(envelope);
  if (envelope.protected.purpose !== "master") {
    throw new TypeError("Expected a master Vault Key wrapper");
  }
  const { kdf, protocolVersion, ...protectedHeader } = envelope.protected;
  if (kdf.name !== "argon2id") throw new TypeError("Expected an Argon2id KDF");
  const { salt, ...publicKdf } = kdf;
  return {
    protocolVersion,
    wrappedVaultKey: {
      protected: protectedHeader,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
    },
    kdf: publicKdf,
    salt,
  };
}

/** Strictly rebuilds the authenticated wrapper header from unlock material. */
export function envelopeFromVaultUnlockMaterial(
  material: VaultUnlockMaterial,
): WrappedVaultKeyEnvelope {
  assertExactKeys(
    material,
    ["kdf", "protocolVersion", "salt", "wrappedVaultKey"],
    "vault unlock material",
  );
  if (material.protocolVersion !== 2) {
    throw new TypeError("Unsupported Vault Protocol version");
  }
  assertExactKeys(material.kdf, KDF_KEYS, "vault unlock KDF");
  assertExactKeys(
    material.wrappedVaultKey,
    ["ciphertext", "nonce", "protected"],
    "wrapped Vault Key",
  );
  const kdf = { ...material.kdf, salt: material.salt } as Argon2KdfHeader;
  const envelope = {
    protected: {
      ...material.wrappedVaultKey.protected,
      kdf,
      protocolVersion: material.protocolVersion,
    },
    nonce: material.wrappedVaultKey.nonce,
    ciphertext: material.wrappedVaultKey.ciphertext,
  } as WrappedVaultKeyEnvelope;
  validateVaultKeyProtectedHeader(envelope.protected);
  return envelope;
}

/** Performs Master Password verification exclusively through local AEAD unwrap. */
export async function unlockVaultLocally(
  material: VaultUnlockMaterial,
  masterPassword: string,
): Promise<Uint8Array> {
  return openMasterVaultKeyWrapper(
    masterPassword,
    envelopeFromVaultUnlockMaterial(material),
  );
}
