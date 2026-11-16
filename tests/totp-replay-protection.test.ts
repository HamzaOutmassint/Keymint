import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    twoFactor: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

import { matchingTotpStep, reserveTotpStep } from "@/server/security/totp";

describe("TOTP replay protection", () => {
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const secret = "test-replay-protection-secret";
  let encryptedSecret: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    encryptedSecret = await symmetricEncrypt({
      key: "development-only-better-auth-secret-change-me",
      data: secret,
    });
    mocks.findUnique.mockResolvedValue({ secret: encryptedSecret });
  });

  it("identifies the exact accepted time-step across the clock-skew window", async () => {
    const otp = createOTP(secret);
    await expect(matchingTotpStep(encryptedSecret, await otp.hotp(step - 1), now)).resolves.toBe(step - 1);
    await expect(matchingTotpStep(encryptedSecret, await otp.hotp(step), now)).resolves.toBe(step);
    await expect(matchingTotpStep(encryptedSecret, await otp.hotp(step + 1), now)).resolves.toBe(step + 1);
    await expect(matchingTotpStep(encryptedSecret, "000000", now, 0)).resolves.toBeNull();
  });

  it("atomically records the step before a login session can be issued", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const code = await createOTP(secret).hotp(step);
    await expect(reserveTotpStep("user-1", code, now)).resolves.toBe("reserved");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: step } }],
      },
      data: { lastUsedTotpStep: step },
    });
  });

  it("rejects a concurrent or repeated claim of the same step", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const code = await createOTP(secret).hotp(step);
    await expect(reserveTotpStep("user-1", code, now)).resolves.toBe("replayed");
  });
});
