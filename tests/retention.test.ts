import { beforeEach, describe, expect, it, vi } from "vitest";

const deleted = vi.fn(async () => ({ count: 1 }));
const prismaMock = {
  activityLog: { deleteMany: deleted },
  verification: { deleteMany: deleted },
  emailChangeRequest: { deleteMany: deleted },
  rateLimitBucket: { deleteMany: deleted },
  rateLimit: { deleteMany: deleted },
  vaultMutation: { deleteMany: deleted },
  $transaction: vi.fn(async (operations: Array<Promise<{ count: number }>>) => Promise.all(operations)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

describe("operational retention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes all expired application-owned security state in one maintenance run", async () => {
    const { enforceOperationalRetention } = await import("@/server/retention");
    const now = new Date("2026-08-02T12:00:00.000Z");
    await expect(enforceOperationalRetention(now)).resolves.toEqual({
      activityLogs: 1,
      verificationRecords: 1,
      emailChangeRequests: 1,
      rateLimitBuckets: 1,
      authRateLimits: 1,
      mutationReceipts: 1,
    });
    expect(prismaMock.verification.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
    expect(prismaMock.emailChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
});
