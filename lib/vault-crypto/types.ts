/** A JSON value accepted by RFC 8785 canonicalization. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object accepted as authenticated protected-header data. */
export type JsonObject = { [key: string]: JsonValue };

/** The fixed Argon2id parameters used by live V2 master and backup wrappers. */
export interface Argon2KdfHeader extends JsonObject {
  iterations: 3;
  memoryKiB: 65536;
  name: "argon2id";
  outputBytes: 32;
  parallelism: 1;
  passwordEncoding: "UTF-8-NFC";
  profile: "KM-ARGON2ID-64M-3T-1P-V1";
  salt: string;
  version: 19;
}

/** The HKDF parameters used by a recovery or recovery-key backup wrapper. */
export interface HkdfKdfHeader extends JsonObject {
  infoProfile:
    | "keymint/vault/v2/recovery-kek"
    | "keymint/vault/v2/backup-recovery-kek";
  name: "HKDF-SHA-256";
  outputBytes: 32;
  salt: string;
}

/** Protected metadata authenticated by a wrapped Vault Key envelope. */
export interface VaultKeyProtectedHeader extends JsonObject {
  cipher: "A256GCM";
  format: "keymint-wrapped-vault-key";
  kdf: Argon2KdfHeader | HkdfKdfHeader;
  keyVersion: number;
  ownerId: string;
  protocolVersion: 2;
  purpose: "master" | "recovery";
  vaultId: string;
  wrapRevision: string;
  wrapVersion: 1;
}

export type VaultRecordType = "credential" | "category" | "vaultSettings" | "vaultActivity" | "tombstone";

/** Legacy (envelope version 1) record AAD, retained byte-for-byte for decrypting older records. */
export interface VaultRecordProtectedHeaderV1 extends JsonObject {
  cipher: "A256GCM";
  envelopeVersion: 1;
  format: "keymint-vault-record";
  keyVersion: number;
  ownerId: string;
  payloadVersion: 1;
  protocolVersion: 2;
  purpose: "vault-record";
  recordId: string;
  revision: string;
  state: "active" | "deleted";
  vaultId: string;
}

/** Canonical authenticated metadata (envelope version 2) for every newly encrypted vault record. */
export interface VaultRecordProtectedHeaderV2 extends JsonObject {
  application: "Keymint";
  cipher: "A256GCM";
  encryptionVersion: 2;
  envelopeVersion: 2;
  format: "keymint-vault-record";
  keyVersion: number;
  ownerId: string;
  payloadVersion: 1;
  protocolVersion: 2;
  purpose: "vault-record";
  recordId: string;
  recordType: VaultRecordType;
  revision: string;
  state: "active" | "deleted";
  userId: string;
  vaultId: string;
}

export type VaultRecordProtectedHeader =
  | VaultRecordProtectedHeaderV1
  | VaultRecordProtectedHeaderV2;

/** A serialized AES-256-GCM envelope whose tag is appended to ciphertext. */
export interface AuthenticatedEnvelope<
  TProtected extends JsonObject = JsonObject,
> extends JsonObject {
  protected: TProtected;
  nonce: string;
  ciphertext: string;
}

/** An AES-GCM wrapped 32-byte Vault Key. */
export type WrappedVaultKeyEnvelope =
  AuthenticatedEnvelope<VaultKeyProtectedHeader>;

/** The only public material downloaded by a browser for a V2 unlock. */
export interface VaultUnlockMaterial {
  protocolVersion: 2;
  wrappedVaultKey: {
    protected: Omit<VaultKeyProtectedHeader, "kdf" | "protocolVersion">;
    nonce: string;
    ciphertext: string;
  };
  kdf: Omit<Argon2KdfHeader, "salt">;
  salt: string;
}

/** An authenticated, opaque V2 vault record. */
export type VaultRecordEnvelope =
  AuthenticatedEnvelope<VaultRecordProtectedHeader>;

/** Fields shared by all active V2 record payloads. */
export interface VaultPayloadBase extends JsonObject {
  createdAt: string;
  id: string;
  payloadVersion: 1;
  revision: string;
  type: "credential" | "category" | "vaultSettings" | "vaultActivity";
  updatedAt: string;
  value: JsonObject;
}

/** One third-party 2FA recovery code; `usedAt` is set when the user marks it spent. */
export interface RecoveryCodeV1 extends JsonObject {
  code: string;
  usedAt: string | null;
}

/** The recovery codes a third-party service issued for a credential's account. */
export interface RecoveryCodeSetV1 extends JsonObject {
  codes: RecoveryCodeV1[];
  updatedAt: string;
}

/**
 * A credential value. `recoveryCodes` is omitted entirely (never null) when the
 * credential has no stored codes, so records written before the field existed
 * remain valid byte-for-byte.
 */
export type CredentialValueV1 = CredentialFieldsV1 & { recoveryCodes?: RecoveryCodeSetV1 };

export interface CredentialFieldsV1 extends JsonObject {
  categoryId: string | null;
  email: string;
  favorite: boolean;
  lastViewedAt: string | null;
  name: string;
  notes: string;
  password: string;
  passwordUpdatedAt: string;
  username: string;
  website: string;
}

export interface CategoryValueV1 extends JsonObject {
  color: string;
  icon: string;
  name: string;
  /** Older category records omit this field at runtime and are treated as unpinned. */
  pinned: boolean;
}

export interface VaultSettingsValueV1 extends JsonObject {
  preferences: JsonObject;
}

export interface VaultActivityValueV1 extends JsonObject {
  action: string;
  description: string;
  occurredAt: string;
  recordId: string | null;
}

/** Versioned plaintext structures. Every credential field, including metadata, is encrypted. */
export type CredentialPayloadV1 = VaultPayloadBase & { type: "credential"; value: CredentialValueV1 };
export type CategoryPayloadV1 = VaultPayloadBase & { type: "category"; value: CategoryValueV1 };
export type VaultSettingsPayloadV1 = VaultPayloadBase & { type: "vaultSettings"; value: VaultSettingsValueV1 };
export type VaultActivityPayloadV1 = VaultPayloadBase & { type: "vaultActivity"; value: VaultActivityValueV1 };
export type ActiveVaultPayloadV1 =
  | CredentialPayloadV1
  | CategoryPayloadV1
  | VaultSettingsPayloadV1
  | VaultActivityPayloadV1;

/** A deleted V2 record payload. */
export interface TombstonePayload extends JsonObject {
  deletedAt: string;
  id: string;
  payloadVersion: 1;
  revision: string;
  type: "tombstone";
}

/** A supported V2 active record payload or tombstone. */
export type VaultPayload = VaultPayloadBase | TombstonePayload;

/** Source identity embedded in a decrypted V2 backup archive. */
export interface BackupSource extends JsonObject {
  keyVersion: number;
  ownerId: string;
  vaultId: string;
}

/** The authenticated plaintext inside a V2 backup. */
export interface BackupArchive extends JsonObject {
  archiveVersion: 1;
  exportedAt: string;
  records: VaultRecordEnvelope[];
  source: BackupSource;
  vaultKey: string;
}

/** Protected metadata authenticated by the first `.kmvault` backup envelope. */
export interface BackupProtectedHeaderV1 extends JsonObject {
  backupId: string;
  backupVersion: 1;
  cipher: "A256GCM";
  createdAt: string;
  format: "keymint-vault-backup";
  kdf: Argon2KdfHeader | HkdfKdfHeader;
  protection: "passphrase" | "recovery-key";
  protocolVersion: 2;
  purpose: "vault-backup";
}

/** Protected metadata authenticated by Backup Format V2. */
export interface BackupProtectedHeaderV2 extends JsonObject {
  backupId: string;
  backupVersion: 2;
  cipher: "A256GCM";
  createdAt: string;
  format: "keymint-vault-backup";
  kdf: Argon2KdfHeader | HkdfKdfHeader;
  kdfVersion: 1;
  protection: "passphrase" | "recovery-key";
  protocolVersion: 2;
  purpose: "vault-backup";
}

/** Any authenticated `.kmvault` protected header retained for import. */
export type BackupProtectedHeader =
  | BackupProtectedHeaderV1
  | BackupProtectedHeaderV2;

/** The read-only first-generation authenticated `.kmvault` envelope. */
export type BackupEnvelopeV1 = AuthenticatedEnvelope<BackupProtectedHeaderV1>;

/** The current Backup Format V2 envelope. */
export type BackupEnvelopeV2 = AuthenticatedEnvelope<BackupProtectedHeaderV2>;

/** Any authenticated `.kmvault` envelope retained for import. */
export type BackupEnvelope = BackupEnvelopeV1 | BackupEnvelopeV2;

/** Parameters used to construct a master-password Vault Key wrapper. */
export interface CreateMasterWrapperOptions {
  vaultKey: Uint8Array;
  masterPassword: string;
  ownerId: string;
  vaultId: string;
  keyVersion: number;
  wrapRevision: string;
}

/** Parameters used to construct a Recovery Key Vault Key wrapper. */
export interface CreateRecoveryWrapperOptions {
  vaultKey: Uint8Array;
  recoverySecret: Uint8Array;
  ownerId: string;
  vaultId: string;
  keyVersion: number;
  wrapRevision: string;
}

/** Parameters used to encrypt and bind a V2 vault record. */
export interface EncryptVaultRecordOptions {
  vaultKey: Uint8Array;
  protected: VaultRecordProtectedHeader;
  payload: VaultPayload;
}

/** Passphrase protection input for backup creation. */
export interface PassphraseBackupProtection {
  type: "passphrase";
  passphrase: string;
}

/** Recovery Key protection input for backup creation. */
export interface RecoveryBackupProtection {
  type: "recovery-key";
  recoverySecret: Uint8Array;
}

/** A supported secret used to protect or open a V2 backup. */
export type BackupProtection =
  | PassphraseBackupProtection
  | RecoveryBackupProtection;

/** Parameters used to create a complete authenticated Backup Format V2 file. */
export interface EncryptBackupOptions {
  backupId: string;
  createdAt: string;
  exportedAt: string;
  source: BackupSource;
  records: VaultRecordEnvelope[];
  vaultKey: Uint8Array;
  protection: BackupProtection;
}

/** Authenticated archive metadata returned without its embedded Vault Key field. */
export interface DecryptedBackupArchive extends JsonObject {
  archiveVersion: 1;
  exportedAt: string;
  records: VaultRecordEnvelope[];
  source: BackupSource;
}

/** Result of opening and fully validating an authenticated backup. */
export interface DecryptedBackup {
  archive: DecryptedBackupArchive;
  vaultKey: Uint8Array;
  records: VaultPayload[];
}

/** Parameters for re-encrypting a Backup Format V1 `.kmvault` file as V2. */
export interface MigrateBackupV1Options {
  backupId: string;
  createdAt: string;
  envelope: BackupEnvelopeV1;
  protection: BackupProtection;
}
