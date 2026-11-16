import {
  assertExactKeys,
  assertIdentifier,
  assertKeyVersion,
  assertTimestamp,
  assertUuidV4,
  canonicalizeJson,
  decodeBase64Url,
  encodeBase64Url,
  encodeUtf8,
  parseCanonicalJson,
  parseStrictJson,
} from "./encoding";
import {
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  createArgon2KdfHeader,
  createHkdfKdfHeader,
  decryptAuthenticated,
  deriveBackupPassphraseKek,
  deriveBackupRecoveryKek,
  encryptAuthenticated,
  KEY_BYTES,
  MASTER_KDF_PROFILE,
  randomBytes,
  SALT_BYTES,
  secureErase,
  TAG_BYTES,
} from "./crypto";
import {
  decryptVaultRecord,
  isTombstone,
  MAX_RECORD_CIPHERTEXT_BYTES,
  validateVaultRecordProtectedHeader,
} from "./records";
import type {
  BackupArchive,
  BackupEnvelope,
  BackupProtectedHeader,
  BackupProtectedHeaderV2,
  BackupEnvelopeV2,
  BackupProtection,
  BackupSource,
  AuthenticatedEnvelope,
  DecryptedBackup,
  EncryptBackupOptions,
  MigrateBackupV1Options,
  VaultPayload,
  VaultRecordEnvelope,
} from "./types";

export const MAX_BACKUP_FILE_BYTES = 96 * 1024 * 1024;
export const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 10000;

/** Strictly validates the authenticated source identity inside a backup archive. */
function validateBackupSource(source: unknown): asserts source is BackupSource {
  assertExactKeys(source, ["keyVersion", "ownerId", "vaultId"], "backup source");
  assertKeyVersion(source.keyVersion);
  assertIdentifier(source.ownerId, "source ownerId");
  assertUuidV4(source.vaultId, "source vaultId");
}
/** Strictly validates a serialized record envelope's outer shape and size. */
function validateBackupRecordEnvelope(record: unknown): asserts record is VaultRecordEnvelope {
  assertExactKeys(record, ["protected", "nonce", "ciphertext"], "backup record envelope");
  validateVaultRecordProtectedHeader(record.protected);
  if (typeof record.nonce !== "string" || typeof record.ciphertext !== "string") {
    throw new TypeError("Backup record binary fields must be strings");
  }
  const nonce = decodeBase64Url(record.nonce, 12);
  const ciphertext = decodeBase64Url(record.ciphertext, MAX_RECORD_CIPHERTEXT_BYTES);
  try {
    if (nonce.byteLength !== 12) throw new TypeError("Backup record nonce must contain 12 bytes");
    if (ciphertext.byteLength < TAG_BYTES) throw new TypeError("Backup record ciphertext is too short");
  } finally {
    secureErase(nonce, ciphertext);
  }
}

/** Strictly validates a decrypted V2 backup archive before any use. */
export function validateBackupArchive(archive: unknown): asserts archive is BackupArchive {
  assertExactKeys(
    archive,
    ["archiveVersion", "exportedAt", "records", "source", "vaultKey"],
    "backup archive",
  );
  if (archive.archiveVersion !== 1) throw new TypeError("Unsupported backup archive version");
  assertTimestamp(archive.exportedAt, "exportedAt");
  validateBackupSource(archive.source);
  if (!Array.isArray(archive.records)) throw new TypeError("Backup records must be an array");
  if (archive.records.length > MAX_BACKUP_RECORDS) {
    throw new RangeError("Backup contains more than 10000 records");
  }
  if (typeof archive.vaultKey !== "string") throw new TypeError("Backup Vault Key must be Base64url text");
  const vaultKey = decodeBase64Url(archive.vaultKey, KEY_BYTES);
  try {
    if (vaultKey.byteLength !== KEY_BYTES) throw new TypeError("Backup Vault Key must contain 32 bytes");
  } finally {
    secureErase(vaultKey);
  }
  for (const record of archive.records) {
    validateBackupRecordEnvelope(record);
    if (
      record.protected.ownerId !== archive.source.ownerId ||
      record.protected.vaultId !== archive.source.vaultId ||
      record.protected.keyVersion !== archive.source.keyVersion
    ) throw new TypeError("Backup record does not match the authenticated source identity");
    if (record.protected.state !== "active") {
      throw new TypeError("Backup archive version 1 must not contain tombstones");
    }
  }
}

/** Strictly validates a backup protected header and its complete KDF profile. */
export function validateBackupProtectedHeader(
  header: unknown,
): asserts header is BackupProtectedHeader {
  if (typeof header !== "object" || header === null || !("backupVersion" in header)) {
    throw new TypeError("Backup protected header is invalid");
  }
  if (header.backupVersion === 1) {
    assertExactKeys(
      header,
      ["backupId", "backupVersion", "cipher", "createdAt", "format", "kdf", "protection", "protocolVersion", "purpose"],
      "Backup Format V1 protected header",
    );
  } else if (header.backupVersion === 2) {
    assertExactKeys(
      header,
      ["backupId", "backupVersion", "cipher", "createdAt", "format", "kdf", "kdfVersion", "protection", "protocolVersion", "purpose"],
      "Backup Format V2 protected header",
    );
    if ((header as Record<string, unknown>).kdfVersion !== 1) {
      throw new TypeError("Unsupported backup KDF version");
    }
  } else {
    throw new TypeError("Unsupported backup version");
  }
  const candidate = header as BackupProtectedHeader;
  if (
    candidate.format !== "keymint-vault-backup" || candidate.purpose !== "vault-backup" ||
    candidate.cipher !== "A256GCM"
  ) throw new TypeError("Unsupported backup format, purpose, or cipher");
  if (candidate.protocolVersion !== 2) {
    throw new TypeError("Unsupported backup version");
  }
  assertUuidV4(candidate.backupId, "backupId");
  assertTimestamp(candidate.createdAt, "createdAt");
  if (candidate.protection === "passphrase") {
    assertExactKeys(candidate.kdf, ["iterations", "memoryKiB", "name", "outputBytes", "parallelism", "passwordEncoding", "profile", "salt", "version"], "backup Argon2 KDF");
    if (
      candidate.kdf.name !== "argon2id" || candidate.kdf.version !== 19 ||
      candidate.kdf.memoryKiB !== ARGON2_MEMORY_KIB || candidate.kdf.iterations !== ARGON2_ITERATIONS ||
      candidate.kdf.parallelism !== ARGON2_PARALLELISM || candidate.kdf.outputBytes !== KEY_BYTES ||
      candidate.kdf.passwordEncoding !== "UTF-8-NFC" || candidate.kdf.profile !== MASTER_KDF_PROFILE
    ) throw new TypeError("Unsupported backup Argon2id profile");
  } else if (candidate.protection === "recovery-key") {
    assertExactKeys(candidate.kdf, ["infoProfile", "name", "outputBytes", "salt"], "backup HKDF");
    if (
      candidate.kdf.name !== "HKDF-SHA-256" || candidate.kdf.outputBytes !== KEY_BYTES ||
      candidate.kdf.infoProfile !== "keymint/vault/v2/backup-recovery-kek"
    ) throw new TypeError("Unsupported backup recovery KDF profile");
  } else {
    throw new TypeError("Unsupported backup protection method");
  }
  if (typeof candidate.kdf.salt !== "string") throw new TypeError("Backup salt must be Base64url text");
  const salt = decodeBase64Url(candidate.kdf.salt, SALT_BYTES);
  try {
    if (salt.byteLength !== SALT_BYTES) throw new TypeError("Backup salt must contain 16 bytes");
  } finally {
    secureErase(salt);
  }
}

/** Derives the purpose-appropriate KEK declared by a validated backup header. */
async function deriveBackupKek(
  header: BackupProtectedHeader,
  protection: BackupProtection,
): Promise<Uint8Array> {
  validateBackupProtectedHeader(header);
  const salt = decodeBase64Url(header.kdf.salt, SALT_BYTES);
  try {
    if (header.protection === "passphrase" && protection.type === "passphrase") {
      return await deriveBackupPassphraseKek(protection.passphrase, salt);
    }
    if (header.protection === "recovery-key" && protection.type === "recovery-key") {
      return await deriveBackupRecoveryKek(protection.recoverySecret, salt, header.backupId);
    }
    throw new TypeError("Backup protection secret does not match the envelope");
  } finally {
    secureErase(salt);
  }
}

/** Authenticates every source record before including it in an export archive. */
async function validateSourceRecords(
  records: VaultRecordEnvelope[],
  source: BackupSource,
  vaultKey: Uint8Array,
): Promise<void> {
  if (records.length > MAX_BACKUP_RECORDS) throw new RangeError("Backup contains too many records");
  const seen = new Set<string>();
  for (const record of records) {
    validateBackupRecordEnvelope(record);
    if (
      record.protected.ownerId !== source.ownerId ||
      record.protected.vaultId !== source.vaultId ||
      record.protected.keyVersion !== source.keyVersion ||
      record.protected.state !== "active"
    ) throw new TypeError("Backup records must be live records from the declared source");
    if (seen.has(record.protected.recordId)) throw new TypeError("Backup contains a duplicate record ID");
    seen.add(record.protected.recordId);
    const payload = await decryptVaultRecord(vaultKey, record);
    if (isTombstone(payload)) throw new TypeError("Backup archive version 1 must not contain tombstones");
  }
}

/** Encrypts and self-tests a complete local V2 backup under an independent secret. */
export async function encryptBackup(
  options: EncryptBackupOptions,
): Promise<BackupEnvelopeV2> {
  if (!(options.vaultKey instanceof Uint8Array) || options.vaultKey.byteLength !== KEY_BYTES) {
    throw new TypeError("Backup source Vault Key must contain 32 bytes");
  }
  assertUuidV4(options.backupId, "backupId");
  assertTimestamp(options.createdAt, "createdAt");
  assertTimestamp(options.exportedAt, "exportedAt");
  if (options.createdAt !== options.exportedAt) {
    throw new TypeError("Backup createdAt and archive exportedAt must match");
  }
  validateBackupSource(options.source);
  await validateSourceRecords(options.records, options.source, options.vaultKey);

  const salt = randomBytes(SALT_BYTES);
  const header: BackupProtectedHeaderV2 = {
    backupId: options.backupId,
    backupVersion: 2,
    cipher: "A256GCM",
    createdAt: options.createdAt,
    format: "keymint-vault-backup",
    kdf:
      options.protection.type === "passphrase"
        ? createArgon2KdfHeader(salt)
        : createHkdfKdfHeader(salt, "keymint/vault/v2/backup-recovery-kek"),
    kdfVersion: 1,
    protection: options.protection.type,
    protocolVersion: 2,
    purpose: "vault-backup",
  };
  const archive: BackupArchive = {
    archiveVersion: 1,
    exportedAt: options.exportedAt,
    records: options.records,
    source: options.source,
    vaultKey: encodeBase64Url(options.vaultKey),
  };
  validateBackupArchive(archive);
  const plaintext = encodeUtf8(canonicalizeJson(archive));
  if (plaintext.byteLength > MAX_BACKUP_ARCHIVE_BYTES) {
    secureErase(salt, plaintext);
    throw new RangeError("Backup archive exceeds 64 MiB");
  }
  let kek: Uint8Array | undefined;
  try {
    kek = await deriveBackupKek(header, options.protection);
    const envelope = await encryptAuthenticated(kek, plaintext, header);
    const selfTest = await decryptAuthenticated(
      kek,
      envelope,
      MAX_BACKUP_ARCHIVE_BYTES + TAG_BYTES,
    );
    try {
      if (canonicalizeJson(parseCanonicalJson(selfTest, MAX_BACKUP_ARCHIVE_BYTES)) !== canonicalizeJson(archive)) {
        throw new Error("Backup self-test did not reproduce the source archive");
      }
    } finally {
      secureErase(selfTest);
    }
    return envelope;
  } finally {
    secureErase(salt, plaintext, kek);
  }
}

/** Authenticates and re-encrypts a first-generation `.kmvault` as Backup Format V2. */
export async function migrateBackupV1ToV2(
  options: MigrateBackupV1Options,
): Promise<BackupEnvelopeV2> {
  if (options.envelope.protected.backupVersion !== 1) {
    throw new TypeError("Only Backup Format V1 can be migrated by this operation");
  }
  const opened = await decryptBackup(options.envelope, options.protection);
  try {
    return await encryptBackup({
      backupId: options.backupId,
      createdAt: options.createdAt,
      exportedAt: options.createdAt,
      protection: options.protection,
      records: opened.archive.records,
      source: opened.archive.source,
      vaultKey: opened.vaultKey,
    });
  } finally {
    secureErase(opened.vaultKey);
  }
}

/** Authenticates a backup and every contained source record before returning plaintext. */
export async function decryptBackup(
  envelope: BackupEnvelope,
  protection: BackupProtection,
): Promise<DecryptedBackup> {
  assertExactKeys(envelope, ["protected", "nonce", "ciphertext"], "backup envelope");
  validateBackupProtectedHeader(envelope.protected);
  let kek: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  try {
    kek = await deriveBackupKek(envelope.protected, protection);
    plaintext = await decryptAuthenticated<BackupProtectedHeader>(
      kek,
      envelope as AuthenticatedEnvelope<BackupProtectedHeader>,
      MAX_BACKUP_ARCHIVE_BYTES + TAG_BYTES,
    );
    const parsed = parseCanonicalJson(plaintext, MAX_BACKUP_ARCHIVE_BYTES);
    validateBackupArchive(parsed);
    if (parsed.exportedAt !== envelope.protected.createdAt) {
      throw new TypeError("Backup archive timestamp does not match its protected header");
    }
    vaultKey = decodeBase64Url(parsed.vaultKey, KEY_BYTES);
    const payloads: VaultPayload[] = [];
    const seen = new Set<string>();
    for (const record of parsed.records) {
      if (seen.has(record.protected.recordId)) throw new TypeError("Backup contains a duplicate record ID");
      seen.add(record.protected.recordId);
      const payload = await decryptVaultRecord(vaultKey, record);
      if (isTombstone(payload)) throw new TypeError("Backup archive version 1 contains a tombstone");
      payloads.push(payload);
    }
    const archiveWithoutKey = {
      archiveVersion: parsed.archiveVersion,
      exportedAt: parsed.exportedAt,
      records: parsed.records,
      source: parsed.source,
    };
    return { archive: archiveWithoutKey, vaultKey, records: payloads };
  } catch (error) {
    if (vaultKey) secureErase(vaultKey);
    throw error;
  } finally {
    secureErase(kek, plaintext);
  }
}

/** Serializes a validated V2 backup envelope as canonical UTF-8 `.kmvault` bytes. */
export function serializeBackup(envelope: BackupEnvelope): Uint8Array {
  assertExactKeys(envelope, ["protected", "nonce", "ciphertext"], "backup envelope");
  validateBackupProtectedHeader(envelope.protected);
  const nonce = decodeBase64Url(envelope.nonce, 12);
  const ciphertext = decodeBase64Url(envelope.ciphertext, MAX_BACKUP_ARCHIVE_BYTES + TAG_BYTES);
  try {
    if (nonce.byteLength !== 12) throw new TypeError("Backup nonce must contain 12 bytes");
    if (ciphertext.byteLength < TAG_BYTES) throw new TypeError("Backup ciphertext is too short");
  } finally {
    secureErase(nonce, ciphertext);
  }
  const bytes = encodeUtf8(canonicalizeJson(envelope));
  if (bytes.byteLength > MAX_BACKUP_FILE_BYTES) {
    secureErase(bytes);
    throw new RangeError("Backup file exceeds 96 MiB");
  }
  return bytes;
}

/** Parses canonical UTF-8 `.kmvault` bytes and validates the strict outer envelope. */
export function parseBackup(bytes: Uint8Array): BackupEnvelope {
  const parsed = parseStrictJson(bytes, MAX_BACKUP_FILE_BYTES);
  assertExactKeys(parsed, ["protected", "nonce", "ciphertext"], "backup envelope");
  validateBackupProtectedHeader(parsed.protected);
  const envelope = parsed as unknown as BackupEnvelope;
  const nonce = decodeBase64Url(envelope.nonce, 12);
  const ciphertext = decodeBase64Url(envelope.ciphertext, MAX_BACKUP_ARCHIVE_BYTES + TAG_BYTES);
  try {
    if (nonce.byteLength !== 12) throw new TypeError("Backup nonce must contain 12 bytes");
    if (ciphertext.byteLength < TAG_BYTES) throw new TypeError("Backup ciphertext is too short");
  } finally {
    secureErase(nonce, ciphertext);
  }
  return envelope;
}
