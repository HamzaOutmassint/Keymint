import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ syncSequence: number; recordId: string }>,
  vault: { id: "vault-1", syncSequence: 700, currentKeyVersion: 1 },
  latestSequence: 700,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vault: {
      findFirst: vi.fn(async () => mocks.vault),
      findUnique: vi.fn(async () => ({ syncSequence: mocks.latestSequence })),
    },
    vaultRecord: { findMany: vi.fn(async () => mocks.rows) },
  },
}));

vi.mock("@/server/v2-vault", () => ({
  serializeVaultRecord: (row: { syncSequence: number; recordId: string }) => ({
    protected: { recordId: row.recordId },
  }),
  validateMutationRecord: vi.fn(),
}));

import { syncEncryptedRecords } from "@/server/vault-record-storage";

beforeEach(() => {
  mocks.rows = [];
  mocks.vault.syncSequence = 700;
  mocks.latestSequence = 700;
});

describe("encrypted vault synchronization pagination", () => {
  it("returns the vault cursor only when every current row fits", async () => {
    mocks.rows = [{ syncSequence: 12, recordId: "record-1" }];
    await expect(syncEncryptedRecords("user-1", 0)).resolves.toMatchObject({
      cursor: "700",
      hasMore: false,
      records: [{ protected: { recordId: "record-1" } }],
    });
  });

  it("never advances past rows omitted from a full page", async () => {
    mocks.rows = [
      ...Array.from({ length: 499 }, (_, index) => ({ syncSequence: index + 1, recordId: `record-${index}` })),
      { syncSequence: 500, recordId: "batch-a" },
      { syncSequence: 500, recordId: "batch-b" },
    ];
    const result = await syncEncryptedRecords("user-1", 0);
    expect(result.cursor).toBe("499");
    expect(result.hasMore).toBe(true);
    expect(result.records).toHaveLength(499);
  });

  it("continues when a concurrent write moves an omitted row past the snapshot", async () => {
    mocks.vault.syncSequence = 12;
    mocks.latestSequence = 13;
    mocks.rows = [];
    await expect(syncEncryptedRecords("user-1", 0)).resolves.toMatchObject({
      cursor: "12",
      hasMore: true,
      records: [],
    });
  });
});
