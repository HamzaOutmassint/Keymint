import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createVaultRecordProtectedHeader,
  createMasterVaultKeyWrapper,
  createRecoveryVaultKeyWrapper,
  decryptVaultRecord,
  encryptVaultRecord,
  generateRecoveryKey,
  generateVaultKey,
  secureErase,
  type CredentialValueV1,
  type VaultPayload,
} from "@/lib/vault-crypto";
import { applyEncryptedRecordMutation } from "@/server/vault-record-storage";
import { serializeVaultRecord } from "@/server/v2-vault";
import {
  abortVaultKeyRotation,
  beginVaultKeyRotation,
  commitVaultKeyRotation,
  stageVaultKeyRotationRecords,
} from "@/server/vault-key-rotation";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const userId = `database-race-${crypto.randomUUID()}`;
const vaultId = crypto.randomUUID();
const key = generateVaultKey();
const now = "2026-08-04T19:00:00.000Z";
const value: CredentialValueV1 = {
  categoryId: null, email: "", favorite: false, lastViewedAt: null,
  name: "Race test", notes: "", password: "secret", passwordUpdatedAt: now,
  username: "alice", website: "",
};

async function envelope(recordId: string, revision: string, name = value.name) {
  const payload: VaultPayload = {
    id: recordId,
    type: "credential",
    payloadVersion: 1,
    revision,
    createdAt: now,
    updatedAt: now,
    value: { ...value, name },
  };
  return encryptVaultRecord({
    vaultKey: key,
    protected: createVaultRecordProtectedHeader({
      ownerId: userId, vaultId, recordId, keyVersion: 1, revision,
      state: "active", recordType: "credential",
    }),
    payload,
  });
}

describeDatabase("PostgreSQL vault mutation concurrency", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, name: "Database Race", email: `${userId}@example.test`, emailVerified: true },
    });
    await prisma.vault.create({ data: { id: vaultId, userId, protocolVersion: 2 } });
  });

  afterAll(async () => {
    secureErase(key);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("commits a concurrent idempotent create exactly once", async () => {
    const record = await envelope("idempotent-record", "1");
    const mutationId = crypto.randomUUID();
    const options = { userId, mutationId, mode: "create" as const, records: [{ expectedRevision: null, envelope: record }] };
    const [first, second] = await Promise.all([
      applyEncryptedRecordMutation(options),
      applyEncryptedRecordMutation(options),
    ]);
    expect(second).toEqual(first);
    await expect(prisma.vaultRecord.count({ where: { vaultId, recordId: "idempotent-record" } })).resolves.toBe(1);
    await expect(prisma.vaultMutation.count({ where: { vaultId, mutationId } })).resolves.toBe(1);
  });

  it("allows only one writer to advance the same source revision", async () => {
    const created = await envelope("revision-record", "1");
    await applyEncryptedRecordMutation({
      userId, mutationId: crypto.randomUUID(), mode: "create",
      records: [{ expectedRevision: null, envelope: created }],
    });
    const [left, right] = await Promise.all([
      envelope("revision-record", "2", "Left writer"),
      envelope("revision-record", "2", "Right writer"),
    ]);
    const settled = await Promise.allSettled([
      applyEncryptedRecordMutation({
        userId, mutationId: crypto.randomUUID(), mode: "update",
        records: [{ expectedRevision: "1", envelope: left }],
      }),
      applyEncryptedRecordMutation({
        userId, mutationId: crypto.randomUUID(), mode: "update",
        records: [{ expectedRevision: "1", envelope: right }],
      }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(prisma.vaultRecord.findUniqueOrThrow({
      where: { vaultId_recordId: { vaultId, recordId: "revision-record" } },
      select: { revision: true },
    })).resolves.toEqual({ revision: "2" });
  });

  it("rolls rotation back on a snapshot conflict, then atomically cuts over after restaging", async () => {
    const newKey = generateVaultKey();
    const recovery = await generateRecoveryKey();
    const wrappers = {
      masterWrapper: await createMasterVaultKeyWrapper({
        vaultKey: newKey, masterPassword: "rotated-master-password",
        ownerId: userId, vaultId, keyVersion: 2, wrapRevision: "1",
      }),
      recoveryWrapper: await createRecoveryVaultKeyWrapper({
        vaultKey: newKey, recoverySecret: recovery.recoverySecret,
        ownerId: userId, vaultId, keyVersion: 2, wrapRevision: "1",
      }),
    };
    const rotateCurrentRows = async () => {
      const rows = await prisma.vaultRecord.findMany({ where: { vaultId }, orderBy: { recordId: "asc" } });
      return Promise.all(rows.map(async (row) => {
        const source = serializeVaultRecord(row);
        const payload = await decryptVaultRecord(key, source);
        const revision = (BigInt(payload.revision) + 1n).toString();
        return {
          expectedRevision: payload.revision,
          envelope: await encryptVaultRecord({
            vaultKey: newKey,
            protected: createVaultRecordProtectedHeader({
              ownerId: userId, vaultId, recordId: payload.id, keyVersion: 2, revision,
              state: payload.type === "tombstone" ? "deleted" : "active", recordType: payload.type,
            }),
            payload: { ...payload, revision } as VaultPayload,
          }),
        };
      }));
    };

    const staleRotationId = crypto.randomUUID();
    await beginVaultKeyRotation({ userId, rotationId: staleRotationId, ...wrappers });
    await stageVaultKeyRotationRecords({ userId, rotationId: staleRotationId, records: await rotateCurrentRows() });
    const source = await prisma.vaultRecord.findUniqueOrThrow({
      where: { vaultId_recordId: { vaultId, recordId: "idempotent-record" } },
    });
    const sourcePayload = await decryptVaultRecord(key, serializeVaultRecord(source));
    const nextRevision = (BigInt(sourcePayload.revision) + 1n).toString();
    const changed = await encryptVaultRecord({
      vaultKey: key,
      protected: createVaultRecordProtectedHeader({
        ownerId: userId, vaultId, recordId: sourcePayload.id, keyVersion: 1,
        revision: nextRevision, state: "active", recordType: "credential",
      }),
      payload: { ...sourcePayload, revision: nextRevision } as VaultPayload,
    });
    await applyEncryptedRecordMutation({
      userId, mutationId: crypto.randomUUID(), mode: "update",
      records: [{ expectedRevision: sourcePayload.revision, envelope: changed }],
    });
    await expect(commitVaultKeyRotation(userId, staleRotationId)).rejects.toThrow(/restart/);
    await expect(prisma.vault.findUniqueOrThrow({ where: { id: vaultId }, select: { currentKeyVersion: true } }))
      .resolves.toEqual({ currentKeyVersion: 1 });

    await abortVaultKeyRotation(userId);
    const rotationId = crypto.randomUUID();
    await beginVaultKeyRotation({ userId, rotationId, ...wrappers });
    await stageVaultKeyRotationRecords({ userId, rotationId, records: await rotateCurrentRows() });
    await expect(commitVaultKeyRotation(userId, rotationId)).resolves.toMatchObject({ rotated: true, keyVersion: 2 });
    await expect(prisma.vault.findUniqueOrThrow({ where: { id: vaultId }, select: { currentKeyVersion: true } }))
      .resolves.toEqual({ currentKeyVersion: 2 });
    const rotatedRows = await prisma.vaultRecord.findMany({ where: { vaultId } });
    expect(rotatedRows.every((row) => row.keyVersion === 2)).toBe(true);
    for (const row of rotatedRows) await expect(decryptVaultRecord(newKey, serializeVaultRecord(row))).resolves.toBeTruthy();
    secureErase(newKey, recovery.recoverySecret);
  }, 30_000);
}, 30_000);
