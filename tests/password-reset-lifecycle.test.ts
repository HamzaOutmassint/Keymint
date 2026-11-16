import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  sessionDeleteMany: vi.fn(),
  verificationDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    session: { deleteMany: mocks.sessionDeleteMany },
    verification: { deleteMany: mocks.verificationDeleteMany },
  },
}));

import {
  revokeUserAccessAfterTwoFactorChange,
  revokeVerificationStateAfterPasswordReset,
} from "@/server/security/auth-lifecycle";

describe("password-reset lifecycle", () => {
  beforeEach(() => {
    mocks.transaction.mockReset();
    mocks.sessionDeleteMany.mockReset();
    mocks.verificationDeleteMany.mockReset();
    mocks.transaction.mockResolvedValue([{ count: 2 }, { count: 3 }]);
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
    mocks.verificationDeleteMany.mockResolvedValue({ count: 3 });
  });

  it("revokes every verification and trusted-device record for the user", async () => {
    await revokeVerificationStateAfterPasswordReset("user-1");

    expect(mocks.verificationDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.verificationDeleteMany).toHaveBeenCalledWith({
      where: { value: "user-1" },
    });
  });

  it("revokes sessions and trusted devices after a two-factor change", async () => {
    await revokeUserAccessAfterTwoFactorChange("user-1");

    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.verificationDeleteMany).toHaveBeenCalledWith({
      where: { value: "user-1" },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("can preserve the reauthenticated session while revoking every other device", async () => {
    await revokeUserAccessAfterTwoFactorChange("user-1", "current-token");

    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", token: { not: "current-token" } },
    });
    expect(mocks.verificationDeleteMany).toHaveBeenCalledWith({
      where: { value: "user-1" },
    });
  });
});
