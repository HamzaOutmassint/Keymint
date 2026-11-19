import {
  assertExactKeys,
  assertIdentifier,
  assertJsonValue,
  assertKeyVersion,
  assertRevision,
  assertTimestamp,
  assertUuidV4,
  canonicalizeJson,
  decodeBase64Url,
  encodeUtf8,
  parseCanonicalJson,
} from "./encoding";
import {
  decryptAuthenticated,
  encryptAuthenticated,
  KEY_BYTES,
  NONCE_BYTES,
  secureErase,
  TAG_BYTES,
} from "./crypto";
import type {
  EncryptVaultRecordOptions,
  TombstonePayload,
  VaultPayload,
  VaultPayloadBase,
  VaultRecordEnvelope,
  VaultRecordProtectedHeader,
  VaultRecordProtectedHeaderV1,
  VaultRecordProtectedHeaderV2,
  VaultRecordType,
} from "./types";

export const MAX_RECORD_PLAINTEXT_BYTES = 65536 as const;
export const MAX_RECOVERY_CODES = 64 as const;
export const MAX_RECOVERY_CODE_LENGTH = 128 as const;

const CREDENTIAL_KEYS = ["categoryId", "email", "favorite", "lastViewedAt", "name", "notes", "password", "passwordUpdatedAt", "username", "website"] as const;
// Any C0/C1 control character, including tabs and line breaks.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
export const MAX_RECORD_CIPHERTEXT_BYTES = MAX_RECORD_PLAINTEXT_BYTES + TAG_BYTES;

/** Validates a complete opaque record envelope without decrypting its payload. */
export function validateVaultRecordEnvelope(
  envelope: unknown,
): asserts envelope is VaultRecordEnvelope {
  assertExactKeys(envelope, ["ciphertext", "nonce", "protected"], "vault record envelope");
  validateVaultRecordProtectedHeader(envelope.protected);
  if (typeof envelope.nonce !== "string" || typeof envelope.ciphertext !== "string") {
    throw new TypeError("Record nonce and ciphertext must be Base64url strings");
  }
  const nonce = decodeBase64Url(envelope.nonce, NONCE_BYTES);
  const ciphertext = decodeBase64Url(envelope.ciphertext, MAX_RECORD_CIPHERTEXT_BYTES);
  try {
    if (nonce.byteLength !== NONCE_BYTES) throw new TypeError("Record nonce must contain 12 bytes");
    if (ciphertext.byteLength < TAG_BYTES || ciphertext.byteLength > MAX_RECORD_CIPHERTEXT_BYTES) {
      throw new TypeError("Record ciphertext has an invalid length");
    }
  } finally {
    secureErase(nonce, ciphertext);
  }
}

/** Validates a string by Unicode scalar count while preserving it exactly. */
function assertStringLength(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) {
    throw new RangeError(`${field} must contain between ${minimum} and ${maximum} characters`);
  }
}

/** Validates a timestamp or the protocol's explicit null sentinel. */
function assertNullableTimestamp(value: unknown, field: string): void {
  if (value !== null) assertTimestamp(value, field);
}

/** Validates a record identifier or the protocol's explicit null sentinel. */
function assertNullableIdentifier(value: unknown, field: string): void {
  if (value !== null) assertIdentifier(value, field);
}

/** Strictly validates the credential value schema and field bounds. */
function validateCredentialValue(value: unknown): void {
  // Credentials written before recovery codes existed omit the field entirely.
  const hasRecoveryCodes = typeof value === "object" && value !== null && "recoveryCodes" in value;
  assertExactKeys(
    value,
    hasRecoveryCodes ? [...CREDENTIAL_KEYS, "recoveryCodes"] : CREDENTIAL_KEYS,
    "credential value",
  );
  if (hasRecoveryCodes) validateRecoveryCodeSet(value.recoveryCodes);
  assertNullableIdentifier(value.categoryId, "categoryId");
  assertStringLength(value.email, 0, 254, "email");
  if (typeof value.favorite !== "boolean") throw new TypeError("favorite must be a boolean");
  assertNullableTimestamp(value.lastViewedAt, "lastViewedAt");
  assertStringLength(value.name, 1, 120, "name");
  assertStringLength(value.notes, 0, 10000, "notes");
  assertStringLength(value.password, 1, 1024, "password");
  assertTimestamp(value.passwordUpdatedAt, "passwordUpdatedAt");
  assertStringLength(value.username, 0, 255, "username");
  assertStringLength(value.website, 0, 2048, "website");
}

/** Comparison key for duplicate detection: case- and whitespace-insensitive. */
export function recoveryCodeIdentity(code: string): string {
  return code.replace(/\s+/g, "").toLocaleLowerCase("en-US");
}

/** Strictly validates a credential's stored third-party recovery codes. */
function validateRecoveryCodeSet(value: unknown): void {
  assertExactKeys(value, ["codes", "updatedAt"], "recovery code set");
  assertTimestamp(value.updatedAt, "recovery codes updatedAt");
  if (!Array.isArray(value.codes) || value.codes.length < 1 || value.codes.length > MAX_RECOVERY_CODES) {
    throw new RangeError(`recovery codes must contain between 1 and ${MAX_RECOVERY_CODES} codes`);
  }
  const seen = new Set<string>();
  for (const item of value.codes) {
    assertExactKeys(item, ["code", "usedAt"], "recovery code");
    assertStringLength(item.code, 1, MAX_RECOVERY_CODE_LENGTH, "recovery code");
    if (item.code.trim() !== item.code || item.code.trim() === "" || CONTROL_CHARACTER.test(item.code)) {
      throw new TypeError("recovery code must be trimmed text without control characters");
    }
    assertNullableTimestamp(item.usedAt, "recovery code usedAt");
    const identity = recoveryCodeIdentity(item.code);
    if (seen.has(identity)) throw new TypeError("recovery codes must not contain duplicates");
    seen.add(identity);
  }
}

/** Strictly validates the category value schema and field bounds. */
function validateCategoryValue(value: unknown): void {
  const hasPinned = typeof value === "object" && value !== null && "pinned" in value;
  assertExactKeys(value, hasPinned ? ["color", "icon", "name", "pinned"] : ["color", "icon", "name"], "category value");
  assertStringLength(value.name, 1, 80, "category name");
  assertStringLength(value.color, 0, 32, "category color");
  assertStringLength(value.icon, 0, 40, "category icon");
  if (hasPinned && typeof value.pinned !== "boolean") {
    throw new TypeError("category pinned must be a boolean");
  }
}

/** Strictly validates the encrypted vault-settings value container. */
function validateVaultSettingsValue(value: unknown): void {
  assertExactKeys(value, ["preferences"], "vault settings value");
  if (value.preferences === null || typeof value.preferences !== "object" || Array.isArray(value.preferences)) {
    throw new TypeError("preferences must be a JSON object");
  }
  assertJsonValue(value.preferences);
}

/** Strictly validates a detailed encrypted vault-activity value. */
function validateVaultActivityValue(value: unknown): void {
  assertExactKeys(value, ["action", "description", "occurredAt", "recordId"], "vault activity value");
  assertStringLength(value.action, 1, 128, "activity action");
  assertStringLength(value.description, 0, 10000, "activity description");
  assertTimestamp(value.occurredAt, "occurredAt");
  assertNullableIdentifier(value.recordId, "activity recordId");
}

/** Strictly validates and version-checks a V2 record protected header. */
export function validateVaultRecordProtectedHeader(
  header: unknown,
): asserts header is VaultRecordProtectedHeader {
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    throw new TypeError("record protected header must be a JSON object");
  }
  if ((header as { envelopeVersion?: unknown }).envelopeVersion === 1) {
    assertExactKeys(
      header,
      ["cipher", "envelopeVersion", "format", "keyVersion", "ownerId", "payloadVersion", "protocolVersion", "purpose", "recordId", "revision", "state", "vaultId"],
      "legacy record protected header",
    );
  } else if ((header as { envelopeVersion?: unknown }).envelopeVersion === 2) {
    assertExactKeys(
      header,
      ["application", "cipher", "encryptionVersion", "envelopeVersion", "format", "keyVersion", "ownerId", "payloadVersion", "protocolVersion", "purpose", "recordId", "recordType", "revision", "state", "userId", "vaultId"],
      "record protected header",
    );
    if (header.application !== "Keymint" || header.encryptionVersion !== 2) {
      throw new TypeError("Unsupported record application or encryption version");
    }
    if (header.userId !== header.ownerId) throw new TypeError("AAD userId must match ownerId");
    if (!["credential", "category", "vaultSettings", "vaultActivity", "tombstone"].includes(header.recordType as string)) {
      throw new TypeError("Unsupported authenticated record type");
    }
    if ((header.state === "deleted") !== (header.recordType === "tombstone")) {
      throw new TypeError("Authenticated record type does not match record state");
    }
  } else {
    throw new TypeError("Unsupported record envelope version");
  }
  if (
    header.cipher !== "A256GCM" || header.format !== "keymint-vault-record" ||
    header.purpose !== "vault-record"
  ) throw new TypeError("Unsupported record format, cipher, or purpose");
  if (header.protocolVersion !== 2 || header.payloadVersion !== 1) {
    throw new TypeError("Unsupported record version");
  }
  if (header.state !== "active" && header.state !== "deleted") {
    throw new TypeError("Unsupported record state");
  }
  assertIdentifier(header.ownerId, "ownerId");
  assertUuidV4(header.vaultId, "vaultId");
  assertIdentifier(header.recordId, "recordId");
  assertKeyVersion(header.keyVersion);
  assertRevision(header.revision, "revision");
}

/** Strictly validates a supported V2 payload and its protected-header bindings. */
export function validateVaultPayload(
  payload: unknown,
  header: VaultRecordProtectedHeader,
): asserts payload is VaultPayload {
  validateVaultRecordProtectedHeader(header);
  if (header.state === "deleted") {
    assertExactKeys(payload, ["deletedAt", "id", "payloadVersion", "revision", "type"], "tombstone payload");
    if (payload.type !== "tombstone") throw new TypeError("Deleted records require tombstone payloads");
    assertTimestamp(payload.deletedAt, "deletedAt");
  } else {
    assertExactKeys(payload, ["createdAt", "id", "payloadVersion", "revision", "type", "updatedAt", "value"], "active payload");
    assertTimestamp(payload.createdAt, "createdAt");
    assertTimestamp(payload.updatedAt, "updatedAt");
    switch (payload.type) {
      case "credential":
        validateCredentialValue(payload.value);
        break;
      case "category":
        validateCategoryValue(payload.value);
        break;
      case "vaultSettings":
        validateVaultSettingsValue(payload.value);
        break;
      case "vaultActivity":
        validateVaultActivityValue(payload.value);
        break;
      default:
        throw new TypeError("Unsupported record payload type");
    }
  }
  if (payload.id !== header.recordId) throw new TypeError("Payload ID does not match protected record ID");
  if (payload.payloadVersion !== header.payloadVersion) {
    throw new TypeError("Payload version does not match protected payload version");
  }
  if (payload.revision !== header.revision) {
    throw new TypeError("Payload revision does not match protected revision");
  }
  if (header.envelopeVersion === 2 && payload.type !== header.recordType) {
    throw new TypeError("Payload type does not match authenticated record type");
  }
}

/** RFC 8785 canonical serialization used identically by record encryption and decryption. */
export function canonicalizeVaultRecordAad(header: VaultRecordProtectedHeader): string {
  validateVaultRecordProtectedHeader(header);
  return canonicalizeJson(header);
}

export function encodeVaultRecordAad(header: VaultRecordProtectedHeader): Uint8Array {
  return encodeUtf8(canonicalizeVaultRecordAad(header));
}

/** Encrypts a complete validated V2 record payload with fresh AES-GCM nonce and bound AAD. */
export async function encryptVaultRecord(
  options: EncryptVaultRecordOptions,
): Promise<VaultRecordEnvelope> {
  if (!(options.vaultKey instanceof Uint8Array) || options.vaultKey.byteLength !== KEY_BYTES) {
    throw new TypeError("Vault Key must contain exactly 32 bytes");
  }
  validateVaultRecordProtectedHeader(options.protected);
  validateVaultPayload(options.payload, options.protected);
  const plaintext = encodeUtf8(canonicalizeJson(options.payload));
  const aad = encodeVaultRecordAad(options.protected);
  if (plaintext.byteLength > MAX_RECORD_PLAINTEXT_BYTES) {
    secureErase(plaintext, aad);
    throw new RangeError("Canonical record payload exceeds 65536 bytes");
  }
  try {
    return await encryptAuthenticated(options.vaultKey, plaintext, options.protected, aad);
  } finally {
    secureErase(plaintext, aad);
  }
}

/** Authenticates, decrypts, and strictly validates one complete V2 record payload. */
export async function decryptVaultRecord(
  vaultKey: Uint8Array,
  envelope: VaultRecordEnvelope,
): Promise<VaultPayload> {
  validateVaultRecordProtectedHeader(envelope.protected);
  const encodedCiphertext = decodeBase64Url(envelope.ciphertext, MAX_RECORD_CIPHERTEXT_BYTES);
  if (encodedCiphertext.byteLength > MAX_RECORD_CIPHERTEXT_BYTES) {
    secureErase(encodedCiphertext);
    throw new RangeError("Record ciphertext exceeds the protocol limit");
  }
  secureErase(encodedCiphertext);
  const aad = encodeVaultRecordAad(envelope.protected);
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = await decryptAuthenticated(
      vaultKey,
      envelope,
      MAX_RECORD_CIPHERTEXT_BYTES,
      aad,
    );
    const payload = parseCanonicalJson(plaintext, MAX_RECORD_PLAINTEXT_BYTES);
    validateVaultPayload(payload, envelope.protected);
    return payload;
  } finally {
    secureErase(plaintext, aad);
  }
}

/** Constructs the strict protected header required before record encryption. */
export function createVaultRecordProtectedHeader(options: {
  ownerId: string;
  vaultId: string;
  recordId: string;
  keyVersion: number;
  revision: string;
  state: "active" | "deleted";
  recordType: VaultRecordType;
}): VaultRecordProtectedHeaderV2 {
  const header: VaultRecordProtectedHeaderV2 = {
    application: "Keymint",
    cipher: "A256GCM",
    encryptionVersion: 2,
    envelopeVersion: 2,
    format: "keymint-vault-record",
    keyVersion: options.keyVersion,
    ownerId: options.ownerId,
    payloadVersion: 1,
    protocolVersion: 2,
    purpose: "vault-record",
    recordId: options.recordId,
    recordType: options.recordType,
    revision: options.revision,
    state: options.state,
    userId: options.ownerId,
    vaultId: options.vaultId,
  };
  validateVaultRecordProtectedHeader(header);
  return header;
}

/** Constructs the exact legacy (envelope version 1) header, needed only for compatibility fixtures/readers. */
export function createLegacyVaultRecordProtectedHeader(options: {
  ownerId: string;
  vaultId: string;
  recordId: string;
  keyVersion: number;
  revision: string;
  state: "active" | "deleted";
}): VaultRecordProtectedHeaderV1 {
  const header: VaultRecordProtectedHeaderV1 = {
    cipher: "A256GCM", envelopeVersion: 1, format: "keymint-vault-record",
    keyVersion: options.keyVersion, ownerId: options.ownerId, payloadVersion: 1,
    protocolVersion: 2, purpose: "vault-record", recordId: options.recordId,
    revision: options.revision, state: options.state, vaultId: options.vaultId,
  };
  validateVaultRecordProtectedHeader(header);
  return header;
}

/** Narrows a supported payload to a tombstone after schema validation. */
export function isTombstone(payload: VaultPayload): payload is TombstonePayload {
  return payload.type === "tombstone";
}

/** Narrows a supported payload to one of the active payload variants. */
export function isActivePayload(payload: VaultPayload): payload is VaultPayloadBase {
  return payload.type !== "tombstone";
}
