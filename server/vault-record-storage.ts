import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { VaultRecordEnvelope } from "@/lib/vault-crypto";
import { MAX_VAULT_RECORDS, VAULT_SYNC_PAGE_SIZE } from "@/lib/vault-limits";
import { ApiError } from "@/server/http";
import { serializeVaultRecord, validateMutationRecord } from "@/server/v2-vault";

type EncryptedMutationItem = {
  expectedRevision: string | null;
  envelope: unknown;
};

type MutationMode = "batch" | "create" | "update" | "delete";

class MutationReplay {
  constructor(readonly response: Prisma.JsonValue) {}
}

function nextRevision(expected: string | null) {
  return expected === null ? "1" : (BigInt(expected) + 1n).toString();
}

async function getCiphertextVault(userId: string) {
  const vault = await prisma.vault.findFirst({
    where: { userId, protocolVersion: 2 },
    select: { id: true, currentKeyVersion: true },
  });
  if (!vault) throw new ApiError(409, "Vault setup is required");
  return vault;
}

/** Fetches one opaque envelope without exposing database or semantic fields. */
export async function fetchEncryptedRecord(userId: string, recordId: string): Promise<VaultRecordEnvelope> {
  const vault = await getCiphertextVault(userId);
  const row = await prisma.vaultRecord.findUnique({
    where: {
      vaultId_recordId: { vaultId: vault.id, recordId },
      ownerId: userId,
      keyVersion: vault.currentKeyVersion,
    },
    select: {
      vaultId: true, ownerId: true, recordId: true, keyVersion: true,
      envelopeVersion: true, payloadVersion: true, encryptionVersion: true,
      revision: true, state: true, protected: true, nonce: true, ciphertext: true,
    },
  });
  if (!row) throw new ApiError(404, "Encrypted vault record not found");
  return serializeVaultRecord(row);
}

/** Returns only opaque envelopes changed after a server synchronization cursor. */
export async function syncEncryptedRecords(userId: string, cursor: number) {
  const vault = await prisma.vault.findFirst({
    where: { userId, protocolVersion: 2 },
    select: { id: true, syncSequence: true, currentKeyVersion: true },
  });
  if (!vault) throw new ApiError(409, "Vault setup is required");
  if (cursor > vault.syncSequence) throw new ApiError(409, "Invalid synchronization cursor");
  const rows = await prisma.vaultRecord.findMany({
    where: {
      ownerId: userId,
      vaultId: vault.id,
      keyVersion: vault.currentKeyVersion,
      syncSequence: { gt: cursor, lte: vault.syncSequence },
    },
    select: {
      vaultId: true, ownerId: true, recordId: true, keyVersion: true,
      envelopeVersion: true, payloadVersion: true, encryptionVersion: true,
      revision: true, state: true, protected: true, nonce: true, ciphertext: true,
      syncSequence: true,
    },
    orderBy: [{ syncSequence: "asc" }, { recordId: "asc" }],
    take: VAULT_SYNC_PAGE_SIZE + 1,
  });

  // A mutation batch shares one sequence. Never split that sequence across
  // pages because the numeric cursor cannot represent a position within it.
  let page = rows;
  let nextCursor = vault.syncSequence;
  if (rows.length > VAULT_SYNC_PAGE_SIZE) {
    const overflowSequence = rows[VAULT_SYNC_PAGE_SIZE].syncSequence;
    page = rows.slice(0, VAULT_SYNC_PAGE_SIZE).filter((row) => row.syncSequence < overflowSequence);
    if (!page.length) throw new ApiError(500, "Encrypted synchronization page is invalid");
    nextCursor = page.at(-1)!.syncSequence;
  }
  // Re-read after the row query. If a concurrent mutation moved a row beyond
  // the captured upper bound, hasMore forces the client to fetch it rather
  // than incorrectly treating the earlier snapshot cursor as complete.
  const latest = await prisma.vault.findUnique({
    where: { id: vault.id, userId },
    select: { syncSequence: true },
  });
  if (!latest) throw new ApiError(409, "Vault setup changed during synchronization");
  return {
    protocolVersion: 2 as const,
    cursor: String(nextCursor),
    hasMore: nextCursor < latest.syncSequence,
    records: page.map(serializeVaultRecord),
  };
}

/** Applies ciphertext-only mutations with ownership, revision, and idempotency checks. */
export async function applyEncryptedRecordMutation(options: {
  userId: string;
  mutationId: string;
  records: EncryptedMutationItem[];
  mode?: MutationMode;
  pathRecordId?: string;
}) {
  const mode = options.mode ?? "batch";
  const vault = await getCiphertextVault(options.userId);
  const replay = await prisma.vaultMutation.findUnique({
    where: { vaultId_mutationId: { vaultId: vault.id, mutationId: options.mutationId } },
    select: { response: true },
  });
  if (replay) return replay.response;

  const submitted = options.records.map((item) => ({
    expectedRevision: item.expectedRevision,
    envelope: validateMutationRecord(item.envelope, options.userId, vault.id, vault.currentKeyVersion),
  }));
  if (new Set(submitted.map((item) => item.envelope.protected.recordId)).size !== submitted.length) {
    throw new ApiError(422, "Encrypted record batch contains duplicate IDs");
  }
  for (const item of submitted) {
    const header = item.envelope.protected;
    if (header.revision !== nextRevision(item.expectedRevision)) {
      throw new ApiError(409, "Encrypted record revision is not the expected successor");
    }
    if (options.pathRecordId && header.recordId !== options.pathRecordId) {
      throw new ApiError(422, "Encrypted record ID does not match the request path");
    }
    if (mode === "create" && (item.expectedRevision !== null || header.state !== "active")) {
      throw new ApiError(422, "Encrypted create requires a new active revision");
    }
    if (mode === "update" && (item.expectedRevision === null || header.state !== "active")) {
      throw new ApiError(422, "Encrypted update requires an existing active revision");
    }
    if (mode === "delete" && (item.expectedRevision === null || header.state !== "deleted")) {
      throw new ApiError(422, "Encrypted deletion requires an existing tombstone revision");
    }
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      // Updating the owning vault first serializes quota and revision checks
      // for this account. Any later error rolls this increment back.
      const advanced = await transaction.vault.update({
        where: { id: vault.id, userId: options.userId },
        data: { syncSequence: { increment: 1 } },
        select: { syncSequence: true },
      });
      // A concurrent request with this idempotency key may have committed
      // while this transaction was waiting for the vault row lock.
      const concurrentReplay = await transaction.vaultMutation.findUnique({
        where: { vaultId_mutationId: { vaultId: vault.id, mutationId: options.mutationId } },
        select: { response: true },
      });
      if (concurrentReplay) throw new MutationReplay(concurrentReplay.response);
      const current = await transaction.vaultRecord.findMany({
        where: {
          ownerId: options.userId,
          vaultId: vault.id,
          recordId: { in: submitted.map((item) => item.envelope.protected.recordId) },
        },
        select: { recordId: true, revision: true },
      });
      const revisions = new Map(current.map((item) => [item.recordId, item.revision]));
      for (const item of submitted) {
        const actual = revisions.get(item.envelope.protected.recordId) ?? null;
        if (actual !== item.expectedRevision) throw new ApiError(409, "Encrypted record changed on another client");
      }
      const creations = submitted.filter((item) => item.expectedRevision === null).length;
      if (creations) {
        const storedRecords = await transaction.vaultRecord.count({
          where: { ownerId: options.userId, vaultId: vault.id },
        });
        if (storedRecords + creations > MAX_VAULT_RECORDS) {
          throw new ApiError(409, `Vault record quota of ${MAX_VAULT_RECORDS} has been reached`);
        }
      }
      const result = [];
      for (const item of submitted) {
        const record = item.envelope;
        const data = {
          keyVersion: record.protected.keyVersion,
          envelopeVersion: record.protected.envelopeVersion,
          payloadVersion: record.protected.payloadVersion,
          encryptionVersion: record.protected.envelopeVersion === 2
            ? record.protected.encryptionVersion
            : 1,
          revision: record.protected.revision,
          state: record.protected.state,
          protected: record.protected as Prisma.InputJsonValue,
          nonce: record.nonce,
          ciphertext: record.ciphertext,
          syncSequence: advanced.syncSequence,
        };
        result.push(item.expectedRevision === null
          ? await transaction.vaultRecord.create({
              data: { ...data, vaultId: vault.id, ownerId: options.userId, recordId: record.protected.recordId },
            })
          : await transaction.vaultRecord.update({
              where: { vaultId_recordId: { vaultId: vault.id, recordId: record.protected.recordId } },
              data,
            }));
      }
      const response = { cursor: String(advanced.syncSequence), records: result.map(serializeVaultRecord) };
      await transaction.vaultMutation.create({
        data: {
          vaultId: vault.id,
          ownerId: options.userId,
          mutationId: options.mutationId,
          response: response as unknown as Prisma.InputJsonValue,
        },
      });
      return response;
    });
  } catch (error) {
    if (error instanceof MutationReplay) return error.response;
    throw error;
  }
}
