import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    twoFactor: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
    $transaction: mocks.transaction,
  },
}));

import { beginTotpEnrollment, completeTotpEnrollment } from "@/server/security/totp";

describe("safe TOTP replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback({
      twoFactor: { updateMany: mocks.updateMany },
      user: { update: mocks.userUpdate },
    }));
  });

  it("writes only pending material when a verified factor already exists", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "factor-1",
      verified: true,
      secret: "active-secret",
      backupCodes: "active-codes",
    });
    mocks.upsert.mockResolvedValue({});

    const result = await beginTotpEnrollment("user-1", "person@example.com");

    expect(result.replacing).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
      update: expect.objectContaining({
        pendingSecret: expect.any(String),
        pendingBackupCodes: expect.any(String),
        pendingExpiresAt: expect.any(Date),
      }),
    }));
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty("secret");
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty("backupCodes");
  });

  it("leaves the active factor untouched when pending verification fails", async () => {
    const pendingSecret = await symmetricEncrypt({
      key: "development-only-better-auth-secret-change-me",
      data: "new-totp-secret",
    });
    mocks.findUnique.mockResolvedValue({
      id: "factor-1",
      secret: "active-secret",
      backupCodes: "active-codes",
      pendingSecret,
      pendingBackupCodes: "pending-codes",
      pendingExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(completeTotpEnrollment("user-1", "123456")).resolves.toBe("invalid");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("promotes pending secret and codes together after verification", async () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    const secret = "new-totp-secret";
    const pendingSecret = await symmetricEncrypt({
      key: "development-only-better-auth-secret-change-me",
      data: secret,
    });
    mocks.findUnique.mockResolvedValue({
      id: "factor-1",
      pendingSecret,
      pendingBackupCodes: "pending-codes",
      pendingExpiresAt: new Date(now + 60_000),
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.userUpdate.mockResolvedValue({});

    const code = await createOTP(secret).hotp(step);
    await expect(completeTotpEnrollment("user-1", code, now)).resolves.toBe("completed");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        secret: pendingSecret,
        backupCodes: "pending-codes",
        verified: true,
        lastUsedTotpStep: step,
        pendingSecret: null,
        pendingBackupCodes: null,
      }),
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { twoFactorEnabled: true },
    });
  });
});
