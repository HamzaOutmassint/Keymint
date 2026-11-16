import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createVaultUnlockMaterial,
  validateWrappedVaultKeyEnvelope,
  type VaultUnlockMaterial,
  validateVaultRecordEnvelope,
  type VaultRecordEnvelope,
  type WrappedVaultKeyEnvelope,
} from "@/lib/vault-crypto";
import { ApiError } from "@/server/http";

/** Validates client-created wrappers while treating ciphertext as opaque. */
export function validateSubmittedWrapper(
  value: unknown,
  ownerId: string,
  purpose: "master" | "recovery",
  vaultId?: string,
): WrappedVaultKeyEnvelope {
  try {
    validateWrappedVaultKeyEnvelope(value);
  } catch {
    throw new ApiError(422, "Invalid Vault Key wrapper");
  }
  const wrapper = value as WrappedVaultKeyEnvelope;
  if (
    wrapper.protected.ownerId !== ownerId ||
    wrapper.protected.purpose !== purpose ||
    wrapper.protected.keyVersion !== 1 ||
    wrapper.protected.wrapRevision !== "1" ||
    (vaultId && wrapper.protected.vaultId !== vaultId)
  ) {
    throw new ApiError(422, "Vault Key wrapper metadata does not match the account");
  }
  return wrapper;
}

/** Validates a wrapper replacement against the authoritative storage tuple. */
function validateReplacementWrapper(
  value: unknown,
  ownerId: string,
  purpose: "master" | "recovery",
  vaultId: string,
  keyVersion: number,
  wrapRevision: string,
): WrappedVaultKeyEnvelope {
  try {
    validateWrappedVaultKeyEnvelope(value);
  } catch {
    throw new ApiError(422, "Invalid Vault Key wrapper");
  }
  const wrapper = value as WrappedVaultKeyEnvelope;
  if (
    wrapper.protected.ownerId !== ownerId ||
    wrapper.protected.purpose !== purpose ||
    wrapper.protected.vaultId !== vaultId ||
    wrapper.protected.keyVersion !== keyVersion ||
    wrapper.protected.wrapRevision !== wrapRevision
  ) {
    throw new ApiError(422, "Vault Key wrapper metadata does not match the current vault");
  }
  return wrapper;
}

/** Validates a first wrapper for the immediately following Vault Key version. */
export function validateRotationWrapper(
  value: unknown,
  ownerId: string,
  purpose: "master" | "recovery",
  vaultId: string,
  targetKeyVersion: number,
): WrappedVaultKeyEnvelope {
  try {
    validateWrappedVaultKeyEnvelope(value);
  } catch {
    throw new ApiError(422, "Invalid rotated Vault Key wrapper");
  }
  const wrapper = value as WrappedVaultKeyEnvelope;
  if (
    wrapper.protected.ownerId !== ownerId ||
    wrapper.protected.purpose !== purpose ||
    wrapper.protected.vaultId !== vaultId ||
    wrapper.protected.keyVersion !== targetKeyVersion ||
    wrapper.protected.wrapRevision !== "1"
  ) throw new ApiError(422, "Rotated Vault Key wrapper metadata does not match the vault");
  return wrapper;
}

type StoredWrapper = {
  vaultId: string;
  ownerId: string;
  keyVersion: number;
  purpose: string;
  wrapVersion: number;
  wrapRevision: string;
  encryptionVersion: number;
  protected: Prisma.JsonValue;
  nonce: string;
  ciphertext: string;
};

/** Reconstructs and validates an opaque wrapper from storage metadata. */
function serializeStoredWrapper(envelope: StoredWrapper): WrappedVaultKeyEnvelope {
  const wrapper = {
    protected: envelope.protected,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  } as WrappedVaultKeyEnvelope;
  try {
    validateWrappedVaultKeyEnvelope(wrapper);
  } catch {
    throw new ApiError(500, "Stored Vault Key wrapper is invalid");
  }
  if (
    envelope.encryptionVersion !== 1 ||
    envelope.vaultId !== wrapper.protected.vaultId ||
    envelope.ownerId !== wrapper.protected.ownerId ||
    envelope.keyVersion !== wrapper.protected.keyVersion ||
    envelope.purpose !== wrapper.protected.purpose ||
    envelope.wrapVersion !== wrapper.protected.wrapVersion ||
    envelope.wrapRevision !== wrapper.protected.wrapRevision
  ) throw new ApiError(500, "Stored Vault Key wrapper metadata is invalid");
  return wrapper;
}

/** Loads only the master envelope fields needed for local browser unlock. */
export async function getVaultUnlockMaterial(userId: string): Promise<VaultUnlockMaterial> {
  const vault = await prisma.vault.findUnique({
    where: { userId, protocolVersion: 2 },
    select: { id: true, currentKeyVersion: true },
  });
  if (!vault) throw new ApiError(409, "Vault setup is required");
  const envelope = await prisma.vaultKeyEnvelope.findUnique({
    where: {
      vaultId_keyVersion_purpose: {
        vaultId: vault.id,
        keyVersion: vault.currentKeyVersion,
        purpose: "master",
      },
      ownerId: userId,
    },
    select: {
      vaultId: true,
      ownerId: true,
      keyVersion: true,
      purpose: true,
      wrapVersion: true,
      wrapRevision: true,
      encryptionVersion: true,
      protected: true,
      nonce: true,
      ciphertext: true,
    },
  });
  if (!envelope) throw new ApiError(409, "Vault setup is required");
  return createVaultUnlockMaterial(serializeStoredWrapper(envelope));
}

/** Loads both public wrappers needed for local recovery and verification. */
export async function getVaultRecoveryMaterial(userId: string): Promise<{
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
}> {
  const vault = await prisma.vault.findUnique({
    where: { userId, protocolVersion: 2 },
    select: { id: true, currentKeyVersion: true },
  });
  if (!vault) throw new ApiError(409, "Vault setup is required");
  const envelopes = await prisma.vaultKeyEnvelope.findMany({
    where: {
      vaultId: vault.id,
      ownerId: userId,
      keyVersion: vault.currentKeyVersion,
      purpose: { in: ["master", "recovery"] },
    },
    select: {
      vaultId: true, ownerId: true, keyVersion: true, purpose: true,
      wrapVersion: true, wrapRevision: true, encryptionVersion: true,
      protected: true, nonce: true, ciphertext: true,
    },
  });
  const master = envelopes.find((item) => item.purpose === "master");
  const recovery = envelopes.find((item) => item.purpose === "recovery");
  if (!master || !recovery) throw new ApiError(409, "Vault recovery is not configured");
  return {
    masterWrapper: serializeStoredWrapper(master),
    recoveryWrapper: serializeStoredWrapper(recovery),
  };
}

function nextRevision(current: string): string {
  try {
    return (BigInt(current) + 1n).toString();
  } catch {
    throw new ApiError(500, "Stored wrapper revision is invalid");
  }
}

function replacementData(wrapper: WrappedVaultKeyEnvelope) {
  return {
    wrapRevision: wrapper.protected.wrapRevision,
    protected: wrapper.protected as Prisma.InputJsonValue,
    nonce: wrapper.nonce,
    ciphertext: wrapper.ciphertext,
  };
}

/** Compare-and-swaps only the master wrapper; no record table is read or written. */
export async function replaceMasterWrapper(
  userId: string,
  submitted: unknown,
): Promise<WrappedVaultKeyEnvelope> {
  return prisma.$transaction(async (tx) => {
    const vault = await tx.vault.findUnique({
      where: { userId, protocolVersion: 2 },
      select: { id: true, currentKeyVersion: true },
    });
    if (!vault) throw new ApiError(409, "Vault setup is required");
    const current = await tx.vaultKeyEnvelope.findUnique({
      where: {
        vaultId_keyVersion_purpose: {
          vaultId: vault.id,
          keyVersion: vault.currentKeyVersion,
          purpose: "master",
        },
        ownerId: userId,
      },
      select: { id: true, wrapRevision: true },
    });
    if (!current) throw new ApiError(409, "Master wrapper is unavailable");
    const wrapper = validateReplacementWrapper(
      submitted,
      userId,
      "master",
      vault.id,
      vault.currentKeyVersion,
      nextRevision(current.wrapRevision),
    );
    const changed = await tx.vaultKeyEnvelope.updateMany({
      where: { id: current.id, wrapRevision: current.wrapRevision },
      data: replacementData(wrapper),
    });
    if (changed.count !== 1) throw new ApiError(409, "Wrapper revision conflict");
    return wrapper;
  });
}

/** Atomically replaces both wrappers after a successful local recovery ceremony. */
export async function replaceRecoveryWrappers(
  userId: string,
  submittedMaster: unknown,
  submittedRecovery: unknown,
): Promise<{
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
}> {
  return prisma.$transaction(async (tx) => {
    const vault = await tx.vault.findUnique({
      where: { userId, protocolVersion: 2 },
      select: { id: true, currentKeyVersion: true },
    });
    if (!vault) throw new ApiError(409, "Vault setup is required");
    const current = await tx.vaultKeyEnvelope.findMany({
      where: {
        vaultId: vault.id,
        ownerId: userId,
        keyVersion: vault.currentKeyVersion,
        purpose: { in: ["master", "recovery"] },
      },
      select: { id: true, purpose: true, wrapRevision: true },
    });
    const oldMaster = current.find((item) => item.purpose === "master");
    const oldRecovery = current.find((item) => item.purpose === "recovery");
    if (!oldMaster || !oldRecovery) throw new ApiError(409, "Vault recovery is not configured");
    const masterWrapper = validateReplacementWrapper(
      submittedMaster, userId, "master", vault.id, vault.currentKeyVersion,
      nextRevision(oldMaster.wrapRevision),
    );
    const recoveryWrapper = validateReplacementWrapper(
      submittedRecovery, userId, "recovery", vault.id, vault.currentKeyVersion,
      nextRevision(oldRecovery.wrapRevision),
    );
    const [masterChanged, recoveryChanged] = await Promise.all([
      tx.vaultKeyEnvelope.updateMany({
        where: { id: oldMaster.id, wrapRevision: oldMaster.wrapRevision },
        data: replacementData(masterWrapper),
      }),
      tx.vaultKeyEnvelope.updateMany({
        where: { id: oldRecovery.id, wrapRevision: oldRecovery.wrapRevision },
        data: replacementData(recoveryWrapper),
      }),
    ]);
    if (masterChanged.count !== 1 || recoveryChanged.count !== 1) {
      throw new ApiError(409, "Wrapper revision conflict");
    }
    return { masterWrapper, recoveryWrapper };
  });
}

export function wrapperCreateData(wrapper: WrappedVaultKeyEnvelope) {
  return {
    vaultId: wrapper.protected.vaultId,
    ownerId: wrapper.protected.ownerId,
    keyVersion: wrapper.protected.keyVersion,
    purpose: wrapper.protected.purpose,
    wrapVersion: wrapper.protected.wrapVersion,
    wrapRevision: wrapper.protected.wrapRevision,
    encryptionVersion: 1,
    protected: wrapper.protected as Prisma.InputJsonValue,
    nonce: wrapper.nonce,
    ciphertext: wrapper.ciphertext,
  };
}

/** Validates an opaque initial record without inspecting its plaintext type. */
export function validateSubmittedRecord(
  value: unknown,
  ownerId: string,
  vaultId: string,
): VaultRecordEnvelope {
  try {
    validateVaultRecordEnvelope(value);
  } catch {
    throw new ApiError(422, "Invalid encrypted vault record");
  }
  const record = value as VaultRecordEnvelope;
  if (
    record.protected.ownerId !== ownerId ||
    record.protected.vaultId !== vaultId ||
    record.protected.keyVersion !== 1 ||
    record.protected.revision !== "1" ||
    record.protected.state !== "active" ||
    record.protected.envelopeVersion !== 2 ||
    record.protected.encryptionVersion !== 2
  ) {
    throw new ApiError(422, "Encrypted record metadata does not match the vault");
  }
  return record;
}

export function recordCreateData(record: VaultRecordEnvelope) {
  const encryptionVersion = record.protected.envelopeVersion === 2
    ? record.protected.encryptionVersion
    : 1;
  return {
    vaultId: record.protected.vaultId,
    ownerId: record.protected.ownerId,
    recordId: record.protected.recordId,
    keyVersion: record.protected.keyVersion,
    envelopeVersion: record.protected.envelopeVersion,
    payloadVersion: record.protected.payloadVersion,
    encryptionVersion,
    revision: record.protected.revision,
    state: record.protected.state,
    protected: record.protected as Prisma.InputJsonValue,
    nonce: record.nonce,
    ciphertext: record.ciphertext,
  };
}

/** Serializes only the opaque envelope; database timestamps and semantic data never cross this boundary. */
export function serializeVaultRecord(record: {
  vaultId: string;
  ownerId: string;
  recordId: string;
  keyVersion: number;
  envelopeVersion: number;
  payloadVersion: number;
  encryptionVersion: number;
  revision: string;
  state: string;
  protected: Prisma.JsonValue;
  nonce: string;
  ciphertext: string;
}): VaultRecordEnvelope {
  const envelope = {
    protected: record.protected,
    nonce: record.nonce,
    ciphertext: record.ciphertext,
  } as VaultRecordEnvelope;
  try {
    validateVaultRecordEnvelope(envelope);
  } catch {
    throw new ApiError(500, "Stored encrypted vault record is invalid");
  }
  const header = envelope.protected;
  const encryptionVersion = header.envelopeVersion === 2
    ? header.encryptionVersion
    : 1;
  if (
    record.vaultId !== header.vaultId ||
    record.ownerId !== header.ownerId ||
    record.recordId !== header.recordId ||
    record.keyVersion !== header.keyVersion ||
    record.envelopeVersion !== header.envelopeVersion ||
    record.payloadVersion !== header.payloadVersion ||
    record.encryptionVersion !== encryptionVersion ||
    record.revision !== header.revision ||
    record.state !== header.state
  ) {
    throw new ApiError(500, "Stored encrypted vault record metadata is invalid");
  }
  return envelope;
}

/** Validates routing metadata for an ordinary V2 mutation without inspecting ciphertext. */
export function validateMutationRecord(
  value: unknown,
  ownerId: string,
  vaultId: string,
  keyVersion: number,
): VaultRecordEnvelope {
  try {
    validateVaultRecordEnvelope(value);
  } catch {
    throw new ApiError(422, "Invalid encrypted vault record");
  }
  const record = value as VaultRecordEnvelope;
  if (
    record.protected.ownerId !== ownerId ||
    record.protected.vaultId !== vaultId ||
    record.protected.keyVersion !== keyVersion ||
    record.protected.envelopeVersion !== 2 ||
    record.protected.encryptionVersion !== 2
  ) throw new ApiError(422, "Encrypted record routing metadata does not match the vault");
  return record;
}
