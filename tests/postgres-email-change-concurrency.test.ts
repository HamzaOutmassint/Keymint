import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/server/security/email-change-mail", () => ({
  sendCurrentEmailChangeVerification: vi.fn(),
  sendNewEmailChangeVerification: vi.fn(),
  sendEmailChangeCompletedNotifications: vi.fn().mockResolvedValue(undefined),
}));

import { EMAIL_CHANGE_STAGES } from "@/lib/email-change-policy";
import { verifyNewEmailChange } from "@/server/security/email-change";
import { createEmailChangeToken, hashEmailChangeToken } from "@/server/security/email-change-tokens";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1";
const describeDatabase = runDatabaseTests ? describe : describe.skip;
const userId = `email-change-race-${crypto.randomUUID()}`;
const oldEmail = `${userId}@example.test`;
const newEmail = `${userId}-new@example.test`;
const token = createEmailChangeToken();
const request = new Request("http://localhost/api/security/email-change/verify-new", {
  method: "POST",
  headers: {
    origin: "http://localhost:3000",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0",
  },
});

describeDatabase("PostgreSQL email-change concurrency", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, name: "Email Race", email: oldEmail, emailVerified: true },
    });
    await prisma.session.createMany({
      data: [
        { id: `${userId}-session-1`, token: `${userId}-token-1`, userId, expiresAt: new Date(Date.now() + 60_000) },
        { id: `${userId}-session-2`, token: `${userId}-token-2`, userId, expiresAt: new Date(Date.now() + 60_000) },
      ],
    });
    await prisma.verification.create({
      data: {
        id: `${userId}-trusted`,
        identifier: `${userId}-identifier`,
        value: userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.emailChangeRequest.create({
      data: {
        userId,
        oldEmail,
        newEmail,
        stage: EMAIL_CHANGE_STAGES.next,
        tokenHash: hashEmailChangeToken(token),
        expiresAt: new Date(Date.now() + 60_000),
        oldVerifiedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("allows one final-link consumer and revokes the account state atomically", async () => {
    const settled = await Promise.allSettled([
      verifyNewEmailChange(request, token),
      verifyNewEmailChange(request, token),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerified: true } }))
      .resolves.toEqual({ email: newEmail, emailVerified: true });
    await expect(prisma.session.count({ where: { userId } })).resolves.toBe(0);
    await expect(prisma.verification.count({ where: { value: userId } })).resolves.toBe(0);
    await expect(prisma.emailChangeRequest.count({ where: { userId } })).resolves.toBe(0);
    await expect(prisma.activityLog.count({ where: { userId, action: "EMAIL_CHANGED" } })).resolves.toBe(1);
  });
});
