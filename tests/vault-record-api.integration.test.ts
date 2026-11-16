import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(public status: number, message: string, public details?: unknown) { super(message); }
  }
  const state = {
    currentRows: [] as Array<{ recordId: string; revision: string }>,
    fetchRow: null as unknown,
    syncRows: [] as unknown[],
    storedRecordCount: 0,
  };
  const transaction = {
    vaultRecord: {
      findMany: vi.fn(async () => state.currentRows),
      count: vi.fn(async () => state.storedRecordCount),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      update: vi.fn(async ({ data }: { data: object }) => ({
        vaultId: "a79a78f8-84e6-4a0e-ae13-10ed28e1d2ae",
        ownerId: "user-1",
        recordId: "test-record",
        ...data,
      })),
    },
    vault: { update: vi.fn(async () => ({ syncSequence: 5 })) },
    vaultMutation: { create: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) },
  };
  return {
    TestApiError,
    state,
    transaction,
    vaultFind: vi.fn(async () => ({ id: "a79a78f8-84e6-4a0e-ae13-10ed28e1d2ae", currentKeyVersion: 1, currentGeneration: 1, syncSequence: 4 })),
    mutationFind: vi.fn(async () => null),
    recordFind: vi.fn(async () => state.fetchRow),
    syncFind: vi.fn(async () => state.syncRows),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vault: { findFirst: mocks.vaultFind, findUnique: mocks.vaultFind },
    vaultMutation: { findUnique: mocks.mutationFind },
    vaultRecord: { findUnique: mocks.recordFind, findFirst: mocks.recordFind, findMany: mocks.syncFind },
    $transaction: vi.fn(async (callback: (transaction: typeof mocks.transaction) => unknown) => callback(mocks.transaction)),
  },
}));

vi.mock("@/server/http", () => ({
  ApiError: mocks.TestApiError,
  assertSameOrigin: (request: Request) => {
    if (request.headers.get("origin") !== "http://localhost") throw new mocks.TestApiError(403, "Invalid request origin");
  },
  assertVaultProtocolV2: (request: Request) => {
    if (request.headers.get("Keymint-Vault-Protocol") !== "2") throw new mocks.TestApiError(426, "Vault Protocol 2 is required");
  },
  requireSession: async () => ({ user: { id: "user-1" } }),
  parseJson: async (request: Request, schema: { parse(value: unknown): unknown }) => schema.parse(await request.json()),
  ok: (data: unknown, init: ResponseInit = {}) => Response.json({ data }, { ...init, headers: { "cache-control": "no-store" } }),
  handleApiError: (error: unknown) => {
    if (error instanceof mocks.TestApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Validation failed" }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "unexpected" }, { status: 500 });
  },
}));

import { DELETE, GET as GET_RECORD, PUT } from "@/app/api/v2/vault/records/[id]/route";
import { POST as CREATE } from "@/app/api/v2/vault/records/route";
import { POST as BATCH } from "@/app/api/v2/vault/records/batch/route";
import { GET as SYNC } from "@/app/api/v2/vault/sync/route";
import {
  createVaultRecordProtectedHeader,
  encryptVaultRecord,
  generateVaultKey,
  secureErase,
  type VaultPayload,
  type VaultRecordEnvelope,
} from "@/lib/vault-crypto";

const VAULT_ID = "a79a78f8-84e6-4a0e-ae13-10ed28e1d2ae";
const RECORD_ID = "test-record";
const CREATED_AT = "2026-08-02T16:00:00.000Z";
const mutationId = () => crypto.randomUUID();
let created: VaultRecordEnvelope;
let updated: VaultRecordEnvelope;
let deleted: VaultRecordEnvelope;

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { origin: "http://localhost", "Keymint-Vault-Protocol": "2", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stored(envelope: VaultRecordEnvelope) {
  return { protected: envelope.protected, nonce: envelope.nonce, ciphertext: envelope.ciphertext };
}

function storedRow(envelope: VaultRecordEnvelope) {
  const header = envelope.protected;
  return {
    vaultId: header.vaultId,
    ownerId: header.ownerId,
    recordId: header.recordId,
    keyVersion: header.keyVersion,
    envelopeVersion: header.envelopeVersion,
    payloadVersion: header.payloadVersion,
    encryptionVersion: header.envelopeVersion === 2 ? header.encryptionVersion : 1,
    revision: header.revision,
    state: header.state,
    ...stored(envelope),
  };
}

beforeAll(async () => {
  const key = generateVaultKey();
  const base: VaultPayload = {
    createdAt: CREATED_AT, id: RECORD_ID, payloadVersion: 1, revision: "1", type: "credential", updatedAt: CREATED_AT,
    value: { categoryId: null, email: "", favorite: false, lastViewedAt: null, name: "Never on server", notes: "",
      password: "plaintext-never-uploaded", passwordUpdatedAt: CREATED_AT, username: "alice", website: "" },
  };
  created = await encryptVaultRecord({
    vaultKey: key,
    protected: createVaultRecordProtectedHeader({ ownerId: "user-1", vaultId: VAULT_ID, recordId: RECORD_ID, keyVersion: 1, revision: "1", state: "active", recordType: "credential" }),
    payload: base,
  });
  updated = await encryptVaultRecord({
    vaultKey: key,
    protected: createVaultRecordProtectedHeader({ ownerId: "user-1", vaultId: VAULT_ID, recordId: RECORD_ID, keyVersion: 1, revision: "2", state: "active", recordType: "credential" }),
    payload: { ...base, revision: "2", updatedAt: "2026-08-02T16:01:00.000Z", value: { ...base.value, name: "Edited locally" } },
  });
  deleted = await encryptVaultRecord({
    vaultKey: key,
    protected: createVaultRecordProtectedHeader({ ownerId: "user-1", vaultId: VAULT_ID, recordId: RECORD_ID, keyVersion: 1, revision: "2", state: "deleted", recordType: "tombstone" }),
    payload: { deletedAt: "2026-08-02T16:02:00.000Z", id: RECORD_ID, payloadVersion: 1, revision: "2", type: "tombstone" },
  });
  secureErase(key);
});

beforeEach(() => {
  mocks.state.currentRows = [];
  mocks.state.fetchRow = storedRow(created);
  mocks.state.syncRows = [{ ...storedRow(created), syncSequence: 4 }];
  mocks.state.storedRecordCount = 0;
  vi.clearAllMocks();
});

describe("ciphertext-only vault endpoint integration", () => {
  it("creates an encrypted record", async () => {
    const response = await CREATE(request("/api/v2/vault/records", "POST", { mutationId: mutationId(), envelope: created }));
    expect(response.status).toBe(201);
    expect(mocks.transaction.vaultRecord.create).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain("plaintext-never-uploaded");
  });

  it("rejects plaintext credential create bodies", async () => {
    const response = await CREATE(request("/api/v2/vault/records", "POST", {
      mutationId: mutationId(), name: "Server must not parse this", password: "plaintext",
    }));
    expect(response.status).toBe(400);
    expect(mocks.transaction.vaultRecord.create).not.toHaveBeenCalled();
  });

  it("fetches an encrypted record without semantic fields", async () => {
    const response = await GET_RECORD(request(`/api/v2/vault/records/${RECORD_ID}`), { params: Promise.resolve({ id: RECORD_ID }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: stored(created) });
  });

  it("updates a browser-edited encrypted record", async () => {
    mocks.state.currentRows = [{ recordId: RECORD_ID, revision: "1" }];
    const response = await PUT(request(`/api/v2/vault/records/${RECORD_ID}`, "PUT", {
      mutationId: mutationId(), expectedRevision: "1", envelope: updated,
    }), { params: Promise.resolve({ id: RECORD_ID }) });
    expect(response.status).toBe(200);
    expect(mocks.transaction.vaultRecord.update).toHaveBeenCalledOnce();
  });

  it("binds encrypted updates to the path record ID", async () => {
    mocks.state.currentRows = [{ recordId: RECORD_ID, revision: "1" }];
    const response = await PUT(request("/api/v2/vault/records/another-record", "PUT", {
      mutationId: mutationId(), expectedRevision: "1", envelope: updated,
    }), { params: Promise.resolve({ id: "another-record" }) });
    expect(response.status).toBe(422);
    expect(mocks.transaction.vaultRecord.update).not.toHaveBeenCalled();
  });

  it("deletes by storing an encrypted tombstone", async () => {
    mocks.state.currentRows = [{ recordId: RECORD_ID, revision: "1" }];
    const response = await DELETE(request(`/api/v2/vault/records/${RECORD_ID}`, "DELETE", {
      mutationId: mutationId(), expectedRevision: "1", envelope: deleted,
    }), { params: Promise.resolve({ id: RECORD_ID }) });
    expect(response.status).toBe(200);
    expect(mocks.transaction.vaultRecord.update).toHaveBeenCalledOnce();
    const storedUpdate = mocks.transaction.vaultRecord.update.mock.calls[0][0] as { data: { state: string } };
    expect(storedUpdate.data.state).toBe("deleted");
  });

  it("rejects deletion without a browser-encrypted tombstone", async () => {
    const response = await DELETE(request(`/api/v2/vault/records/${RECORD_ID}`, "DELETE", {
      mutationId: mutationId(), expectedRevision: "1", envelope: updated,
    }), { params: Promise.resolve({ id: RECORD_ID }) });
    expect(response.status).toBe(422);
    expect(mocks.transaction.vaultRecord.update).not.toHaveBeenCalled();
  });

  it("synchronizes opaque envelopes", async () => {
    const response = await SYNC(request("/api/v2/vault/sync?cursor=0"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { cursor: "4", hasMore: false, protocolVersion: 2, records: [stored(created)] } });
  });

  it("keeps bounded encrypted batch synchronization", async () => {
    const response = await BATCH(request("/api/v2/vault/records/batch", "POST", {
      mutationId: mutationId(), records: [{ expectedRevision: null, envelope: created }],
    }));
    expect(response.status).toBe(200);
    expect(mocks.transaction.vaultRecord.create).toHaveBeenCalledOnce();
  });

  it("atomically rejects creates after the account record quota", async () => {
    mocks.state.storedRecordCount = 2_500;
    const response = await CREATE(request("/api/v2/vault/records", "POST", {
      mutationId: mutationId(), envelope: created,
    }));
    expect(response.status).toBe(409);
    expect(mocks.transaction.vaultRecord.create).not.toHaveBeenCalled();
  });

  it("requires the V2 protocol header on every encrypted endpoint", async () => {
    const response = await GET_RECORD(new Request(`http://localhost/api/v2/vault/records/${RECORD_ID}`), {
      params: Promise.resolve({ id: RECORD_ID }),
    });
    expect(response.status).toBe(426);
  });
});
