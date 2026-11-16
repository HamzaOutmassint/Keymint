import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  requestCreate: vi.fn(),
  requestFindFirst: vi.fn(),
  requestFindUnique: vi.fn(),
  requestUpdateMany: vi.fn(),
  requestDeleteMany: vi.fn(),
  requestDelete: vi.fn(),
  sessionDeleteMany: vi.fn(),
  verificationDeleteMany: vi.fn(),
  activityCreate: vi.fn(),
  logActivity: vi.fn(),
  sendCurrent: vi.fn(),
  sendNew: vi.fn(),
  sendCompleted: vi.fn(),
}));

const transactionClient = {
  user: { findFirst: mocks.userFindFirst, updateMany: mocks.userUpdateMany },
  emailChangeRequest: {
    create: mocks.requestCreate,
    findUnique: mocks.requestFindUnique,
    deleteMany: mocks.requestDeleteMany,
    delete: mocks.requestDelete,
  },
  session: { deleteMany: mocks.sessionDeleteMany },
  verification: { deleteMany: mocks.verificationDeleteMany },
  activityLog: { create: mocks.activityCreate },
};

vi.mock("@/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    emailChangeRequest: {
      create: mocks.requestCreate,
      findFirst: mocks.requestFindFirst,
      findUnique: mocks.requestFindUnique,
      updateMany: mocks.requestUpdateMany,
      deleteMany: mocks.requestDeleteMany,
    },
    $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient),
    ),
  },
}));
vi.mock("@/server/activity", () => ({
  activityRecordData: vi.fn((_request, userId, action) => ({
    userId,
    action,
    description: action,
    device: "Desktop",
    browser: "Unknown",
    os: "Unknown",
    ip: "Unavailable",
  })),
  logActivity: mocks.logActivity,
}));
vi.mock("@/server/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/server/security/email-change-mail", () => ({
  sendCurrentEmailChangeVerification: mocks.sendCurrent,
  sendNewEmailChangeVerification: mocks.sendNew,
  sendEmailChangeCompletedNotifications: mocks.sendCompleted,
}));

import { EMAIL_CHANGE_STAGES } from "@/lib/email-change-policy";
import {
  startEmailChange,
  verifyCurrentEmailChange,
  verifyNewEmailChange,
} from "@/server/security/email-change";
import {
  createEmailChangeToken,
  hashEmailChangeToken,
} from "@/server/security/email-change-tokens";

const request = new Request("http://localhost/api/security/email-change", {
  method: "POST",
  headers: { origin: "http://localhost" },
});

describe("secure email-change ceremony", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    mocks.requestCreate.mockResolvedValue({ id: "change-1" });
    mocks.requestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.requestDeleteMany.mockResolvedValue({ count: 1 });
    mocks.requestDelete.mockResolvedValue({ id: "change-1" });
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
    mocks.verificationDeleteMany.mockResolvedValue({ count: 3 });
    mocks.activityCreate.mockResolvedValue({ id: "activity-1" });
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.sendCurrent.mockResolvedValue(undefined);
    mocks.sendNew.mockResolvedValue(undefined);
    mocks.sendCompleted.mockResolvedValue(undefined);
  });

  it("creates high-entropy tokens with stable SHA-256 hashes", () => {
    const token = createEmailChangeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(hashEmailChangeToken(token)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashEmailChangeToken(token)).toBe(hashEmailChangeToken(token));
  });

  it("stores only a hash and sends the raw first-stage token to the current address", async () => {
    await startEmailChange({
      request,
      user: {
        id: "user-1",
        name: "Owner <Admin>",
        email: "owner@example.test",
        emailVerified: true,
      },
      newEmail: "new@example.test",
    });

    const sentToken = mocks.sendCurrent.mock.calls[0][0].token as string;
    const stored = mocks.requestCreate.mock.calls[0][0].data;
    expect(stored).toMatchObject({
      userId: "user-1",
      oldEmail: "owner@example.test",
      newEmail: "new@example.test",
      stage: EMAIL_CHANGE_STAGES.current,
    });
    expect(stored.tokenHash).toBe(hashEmailChangeToken(sentToken));
    expect(JSON.stringify(stored)).not.toContain(sentToken);
  });

  it("does not send anything when the destination belongs to another account", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "user-2" });
    await expect(startEmailChange({
      request,
      user: {
        id: "user-1",
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
      },
      newEmail: "used@example.test",
    })).resolves.toEqual({ accepted: true });
    expect(mocks.sendCurrent).not.toHaveBeenCalled();
    expect(mocks.requestCreate).not.toHaveBeenCalled();
  });

  it("requires current-address verification before rotating to a new-address token", async () => {
    const firstToken = createEmailChangeToken();
    mocks.requestFindUnique.mockResolvedValueOnce({
      id: "change-1",
      userId: "user-1",
      oldEmail: "owner@example.test",
      newEmail: "new@example.test",
      stage: EMAIL_CHANGE_STAGES.current,
      tokenHash: hashEmailChangeToken(firstToken),
      expiresAt: new Date(Date.now() + 60_000),
      oldVerifiedAt: null,
      user: { id: "user-1", name: "Owner", email: "owner@example.test" },
    });

    await verifyCurrentEmailChange(firstToken);
    const nextToken = mocks.sendNew.mock.calls[0][0].token as string;
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stage: EMAIL_CHANGE_STAGES.next,
        tokenHash: hashEmailChangeToken(nextToken),
        oldVerifiedAt: expect.any(Date),
      }),
    }));
  });

  it("atomically updates the identifier, consumes the request, and revokes access", async () => {
    const secondToken = createEmailChangeToken();
    mocks.requestFindUnique.mockResolvedValueOnce({
      id: "change-1",
      userId: "user-1",
      oldEmail: "owner@example.test",
      newEmail: "new@example.test",
      stage: EMAIL_CHANGE_STAGES.next,
      tokenHash: hashEmailChangeToken(secondToken),
      expiresAt: new Date(Date.now() + 60_000),
      oldVerifiedAt: new Date(),
      user: { id: "user-1", name: "Owner", email: "owner@example.test" },
    });

    await expect(verifyNewEmailChange(request, secondToken)).resolves.toEqual({
      changed: true,
      email: "new@example.test",
    });
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        email: { equals: "owner@example.test", mode: "insensitive" },
      },
      data: { email: "new@example.test", emailVerified: true },
    });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.verificationDeleteMany).toHaveBeenCalledWith({ where: { value: "user-1" } });
    expect(mocks.requestDelete).toHaveBeenCalledWith({ where: { id: "change-1" } });
    expect(mocks.activityCreate).toHaveBeenCalled();
  });

  it("rejects expired and replayed first-stage tokens without sending mail", async () => {
    mocks.requestFindUnique.mockResolvedValueOnce(null);
    await expect(verifyCurrentEmailChange(createEmailChangeToken())).rejects.toThrow(
      /invalid, expired, or already used/u,
    );
    expect(mocks.sendNew).not.toHaveBeenCalled();
  });
});
