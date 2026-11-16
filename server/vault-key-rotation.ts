import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_VAULT_RECORDS } from "@/lib/vault-limits";
import type { WrappedVaultKeyEnvelope } from "@/lib/vault-crypto";
import { ApiError } from "@/server/http";
import {
  recordCreateData,
  validateMutationRecord,
  validateRotationWrapper,
  wrapperCreateData,
} from "@/server/v2-vault";

type RotationRecord = { expectedRevision: string; envelope: unknown };

function nextRevision(value: string) {
  try {
    return (BigInt(value) + 1n).toString();
  } catch {
    throw new ApiError(422, "Invalid source record revision");
  }
}

export async function beginVaultKeyRotation(options: {
  userId: string;
  rotationId: string;
  masterWrapper: unknown;
  recoveryWrapper: unknown;
}) {
  return prisma.$transaction(async (tx) => {
    const vault = await tx.vault.findUnique({
      where: { userId: options.userId, protocolVersion: 2 },
      select: { id: true, currentKeyVersion: true, syncSequence: true },
    });
    if (!vault) throw new ApiError(409, "Vault setup is required");
    const targetKeyVersion = vault.currentKeyVersion + 1;
    const master = validateRotationWrapper(
      options.masterWrapper, options.userId, "master", vault.id, targetKeyVersion,
    );
    const recovery = validateRotationWrapper(
      options.recoveryWrapper, options.userId, "recovery", vault.id, targetKeyVersion,
    );
    const expectedRecordCount = await tx.vaultRecord.count({
      where: { vaultId: vault.id, ownerId: options.userId, keyVersion: vault.currentKeyVersion },
    });
    if (expectedRecordCount > MAX_VAULT_RECORDS) throw new ApiError(409, "Vault exceeds the rotation quota");
    await tx.vaultKeyRotation.deleteMany({ where: { vaultId: vault.id, ownerId: options.userId } });
    await tx.vaultKeyRotation.create({
      data: {
        id: options.rotationId,
        vaultId: vault.id,
        ownerId: options.userId,
        sourceKeyVersion: vault.currentKeyVersion,
        targetKeyVersion,
        snapshotSequence: vault.syncSequence,
        expectedRecordCount,
        masterProtected: master.protected as Prisma.InputJsonValue,
        masterNonce: master.nonce,
        masterCiphertext: master.ciphertext,
        recoveryProtected: recovery.protected as Prisma.InputJsonValue,
        recoveryNonce: recovery.nonce,
        recoveryCiphertext: recovery.ciphertext,
      },
    });
    return { rotationId: options.rotationId, targetKeyVersion, expectedRecordCount, stagedRecordCount: 0 };
  });
}

export async function getVaultKeyRotation(userId: string) {
  const rotation = await prisma.vaultKeyRotation.findFirst({
    where: { ownerId: userId },
    select: {
      id: true, targetKeyVersion: true, expectedRecordCount: true,
      records: { select: { recordId: true, sourceRevision: true }, orderBy: { recordId: "asc" } },
    },
  });
  return rotation ? {
    rotationId: rotation.id,
    targetKeyVersion: rotation.targetKeyVersion,
    expectedRecordCount: rotation.expectedRecordCount,
    stagedRecordCount: rotation.records.length,
    stagedRecords: rotation.records,
  } : null;
}

export async function abortVaultKeyRotation(userId: string) {
  await prisma.vaultKeyRotation.deleteMany({ where: { ownerId: userId } });
  return { aborted: true };
}

export async function stageVaultKeyRotationRecords(options: {
  userId: string;
  rotationId: string;
  records: RotationRecord[];
}) {
  return prisma.$transaction(async (tx) => {
    const rotation = await tx.vaultKeyRotation.findUnique({
      where: { id: options.rotationId, ownerId: options.userId },
      select: {
        id: true, vaultId: true, ownerId: true, sourceKeyVersion: true,
        targetKeyVersion: true, snapshotSequence: true, expectedRecordCount: true,
      },
    });
    if (!rotation) throw new ApiError(404, "Vault Key rotation was not found");
    const vault = await tx.vault.findUnique({
      where: { id: rotation.vaultId, userId: options.userId },
      select: { currentKeyVersion: true, syncSequence: true },
    });
    if (!vault || vault.currentKeyVersion !== rotation.sourceKeyVersion || vault.syncSequence !== rotation.snapshotSequence) {
      throw new ApiError(409, "Vault changed during key rotation; restart the rotation");
    }
    const submitted = options.records.map((item) => ({
      expectedRevision: item.expectedRevision,
      envelope: validateMutationRecord(
        item.envelope, options.userId, rotation.vaultId, rotation.targetKeyVersion,
      ),
    }));
    if (new Set(submitted.map((item) => item.envelope.protected.recordId)).size !== submitted.length) {
      throw new ApiError(422, "Rotation batch contains duplicate record IDs");
    }
    const current = await tx.vaultRecord.findMany({
      where: {
        vaultId: rotation.vaultId,
        ownerId: options.userId,
        keyVersion: rotation.sourceKeyVersion,
        recordId: { in: submitted.map((item) => item.envelope.protected.recordId) },
      },
      select: { recordId: true, revision: true, state: true },
    });
    const currentById = new Map(current.map((record) => [record.recordId, record]));
    for (const item of submitted) {
      const source = currentById.get(item.envelope.protected.recordId);
      if (
        !source || source.revision !== item.expectedRevision ||
        item.envelope.protected.revision !== nextRevision(item.expectedRevision) ||
        item.envelope.protected.state !== source.state
      ) throw new ApiError(409, "Vault record changed during key rotation");
      const record = recordCreateData(item.envelope);
      await tx.vaultKeyRotationRecord.upsert({
        where: { rotationId_recordId: { rotationId: rotation.id, recordId: record.recordId } },
        create: {
          rotationId: rotation.id,
          sourceRevision: item.expectedRevision,
          ...record,
        },
        update: { sourceRevision: item.expectedRevision, ...record },
      });
    }
    const stagedRecordCount = await tx.vaultKeyRotationRecord.count({ where: { rotationId: rotation.id } });
    if (stagedRecordCount > rotation.expectedRecordCount) throw new ApiError(409, "Rotation contains unexpected records");
    return { rotationId: rotation.id, expectedRecordCount: rotation.expectedRecordCount, stagedRecordCount };
  });
}

export async function commitVaultKeyRotation(userId: string, rotationId: string) {
  return prisma.$transaction(async (tx) => {
    const rotation = await tx.vaultKeyRotation.findUnique({
      where: { id: rotationId, ownerId: userId },
      include: { records: true },
    });
    if (!rotation) throw new ApiError(404, "Vault Key rotation was not found");
    if (rotation.records.length !== rotation.expectedRecordCount) {
      throw new ApiError(409, "Vault Key rotation is not fully staged");
    }
    const advanced = await tx.vault.updateMany({
      where: {
        id: rotation.vaultId,
        userId,
        currentKeyVersion: rotation.sourceKeyVersion,
        syncSequence: rotation.snapshotSequence,
      },
      data: {
        currentKeyVersion: rotation.targetKeyVersion,
        syncSequence: { increment: 1 },
      },
    });
    if (advanced.count !== 1) throw new ApiError(409, "Vault changed during key rotation; restart the rotation");
    const syncSequence = rotation.snapshotSequence + 1;
    await tx.vaultRecord.deleteMany({ where: { vaultId: rotation.vaultId, ownerId: userId } });
    if (rotation.records.length) {
      await tx.vaultRecord.createMany({
        data: rotation.records.map((record) => ({
          vaultId: record.vaultId,
          ownerId: record.ownerId,
          recordId: record.recordId,
          keyVersion: record.keyVersion,
          envelopeVersion: record.envelopeVersion,
          payloadVersion: record.payloadVersion,
          encryptionVersion: record.encryptionVersion,
          revision: record.revision,
          state: record.state,
          protected: record.protected as Prisma.InputJsonValue,
          nonce: record.nonce,
          ciphertext: record.ciphertext,
          syncSequence,
        })),
      });
    }
    await tx.vaultKeyEnvelope.deleteMany({ where: { vaultId: rotation.vaultId, ownerId: userId } });
    const master = {
      protected: rotation.masterProtected,
      nonce: rotation.masterNonce,
      ciphertext: rotation.masterCiphertext,
    } as WrappedVaultKeyEnvelope;
    const recovery = {
      protected: rotation.recoveryProtected,
      nonce: rotation.recoveryNonce,
      ciphertext: rotation.recoveryCiphertext,
    } as WrappedVaultKeyEnvelope;
    validateRotationWrapper(master, userId, "master", rotation.vaultId, rotation.targetKeyVersion);
    validateRotationWrapper(recovery, userId, "recovery", rotation.vaultId, rotation.targetKeyVersion);
    await tx.vaultKeyEnvelope.createMany({ data: [wrapperCreateData(master), wrapperCreateData(recovery)] });
    await tx.vaultMutation.deleteMany({ where: { vaultId: rotation.vaultId, ownerId: userId } });
    await tx.vaultKeyRotation.delete({ where: { id: rotation.id } });
    return { rotated: true, keyVersion: rotation.targetKeyVersion, cursor: String(syncSequence) };
  });
}
