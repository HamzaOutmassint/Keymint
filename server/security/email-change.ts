import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  EMAIL_CHANGE_STAGES,
  EMAIL_CHANGE_TOKEN_TTL_MS,
  type EmailChangeStage,
} from "@/lib/email-change-policy";
import { activityRecordData, logActivity } from "@/server/activity";
import { ApiError } from "@/server/http";
import {
  sendCurrentEmailChangeVerification,
  sendEmailChangeCompletedNotifications,
  sendNewEmailChangeVerification,
} from "@/server/security/email-change-mail";
import {
  createEmailChangeToken,
  hashEmailChangeToken,
} from "@/server/security/email-change-tokens";

const INVALID_REQUEST_MESSAGE =
  "This email-change request is invalid, expired, or already used";

function invalidRequest() {
  return new ApiError(400, INVALID_REQUEST_MESSAGE);
}

function expiresAt(now = new Date()) {
  return new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS);
}

async function emailBelongsToAnotherUser(email: string, userId: string) {
  return Boolean(
    await prisma.user.findFirst({
      where: {
        id: { not: userId },
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    }),
  );
}

export async function startEmailChange({
  request,
  user,
  newEmail,
}: {
  request: Request;
  user: { id: string; name: string; email: string; emailVerified: boolean };
  newEmail: string;
}) {
  const oldEmail = user.email.toLowerCase();
  if (!user.emailVerified) {
    throw new ApiError(403, "Verify your current email before changing it");
  }
  if (newEmail === oldEmail) {
    throw new ApiError(400, "Enter a different email address");
  }

  // Preserve a generic success path when the target already belongs to an
  // account so this authenticated endpoint does not become an email oracle.
  if (await emailBelongsToAnotherUser(newEmail, user.id)) {
    await prisma.emailChangeRequest.deleteMany({ where: { userId: user.id } });
    return { accepted: true as const };
  }

  const token = createEmailChangeToken();
  const tokenHash = hashEmailChangeToken(token);
  const pending = await prisma.$transaction(async (tx) => {
    await tx.emailChangeRequest.deleteMany({ where: { userId: user.id } });
    return tx.emailChangeRequest.create({
      data: {
        userId: user.id,
        oldEmail,
        newEmail,
        stage: EMAIL_CHANGE_STAGES.current,
        tokenHash,
        expiresAt: expiresAt(),
      },
      select: { id: true },
    });
  });

  try {
    await sendCurrentEmailChangeVerification({
      name: user.name,
      oldEmail,
      newEmail,
      token,
    });
  } catch {
    await prisma.emailChangeRequest.deleteMany({
      where: { id: pending.id, tokenHash },
    });
    throw new ApiError(503, "Unable to send the confirmation email");
  }

  await logActivity(request, user.id, "EMAIL_CHANGE_REQUESTED").catch(() => {
    console.error(JSON.stringify({ event: "email-change-activity-log-failed" }));
  });
  return { accepted: true as const };
}

export async function getPendingEmailChange(userId: string) {
  const pending = await prisma.emailChangeRequest.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    select: {
      newEmail: true,
      stage: true,
      expiresAt: true,
      oldVerifiedAt: true,
    },
  });
  return pending
    ? {
        ...pending,
        stage: pending.stage as EmailChangeStage,
        expiresAt: pending.expiresAt.toISOString(),
        oldVerifiedAt: pending.oldVerifiedAt?.toISOString() ?? null,
      }
    : null;
}

export async function cancelEmailChange(request: Request, userId: string) {
  const activity = activityRecordData(
    request,
    userId,
    "EMAIL_CHANGE_CANCELLED",
  );
  const cancelled = await prisma.$transaction(async (tx) => {
    const removed = await tx.emailChangeRequest.deleteMany({
      where: { userId },
    });
    if (removed.count) await tx.activityLog.create({ data: activity });
    return removed.count > 0;
  });
  return { cancelled };
}

export async function resendEmailChange(userId: string) {
  const pending = await prisma.emailChangeRequest.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!pending || pending.user.email.toLowerCase() !== pending.oldEmail) {
    throw invalidRequest();
  }
  if (await emailBelongsToAnotherUser(pending.newEmail, pending.userId)) {
    await prisma.emailChangeRequest.deleteMany({ where: { id: pending.id } });
    throw invalidRequest();
  }

  const token = createEmailChangeToken();
  const nextHash = hashEmailChangeToken(token);
  try {
    if (pending.stage === EMAIL_CHANGE_STAGES.current) {
      await sendCurrentEmailChangeVerification({
        name: pending.user.name,
        oldEmail: pending.oldEmail,
        newEmail: pending.newEmail,
        token,
      });
    } else if (pending.stage === EMAIL_CHANGE_STAGES.next) {
      await sendNewEmailChangeVerification({
        name: pending.user.name,
        newEmail: pending.newEmail,
        token,
      });
    } else {
      throw invalidRequest();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Unable to resend the verification email");
  }

  const updated = await prisma.emailChangeRequest.updateMany({
    where: {
      id: pending.id,
      tokenHash: pending.tokenHash,
      stage: pending.stage,
      expiresAt: { gt: new Date() },
    },
    data: { tokenHash: nextHash, expiresAt: expiresAt() },
  });
  if (updated.count !== 1) throw invalidRequest();
  return { sent: true as const };
}

export async function verifyCurrentEmailChange(token: string) {
  const tokenHash = hashEmailChangeToken(token);
  const pending = await prisma.emailChangeRequest.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (
    !pending ||
    pending.stage !== EMAIL_CHANGE_STAGES.current ||
    pending.expiresAt <= new Date() ||
    pending.user.email.toLowerCase() !== pending.oldEmail
  ) {
    throw invalidRequest();
  }
  if (await emailBelongsToAnotherUser(pending.newEmail, pending.userId)) {
    await prisma.emailChangeRequest.deleteMany({ where: { id: pending.id } });
    throw invalidRequest();
  }

  const nextToken = createEmailChangeToken();
  const nextHash = hashEmailChangeToken(nextToken);
  try {
    await sendNewEmailChangeVerification({
      name: pending.user.name,
      newEmail: pending.newEmail,
      token: nextToken,
    });
  } catch {
    throw new ApiError(503, "Unable to send verification to the new address");
  }

  const now = new Date();
  const updated = await prisma.emailChangeRequest.updateMany({
    where: {
      id: pending.id,
      stage: EMAIL_CHANGE_STAGES.current,
      tokenHash,
      expiresAt: { gt: now },
    },
    data: {
      stage: EMAIL_CHANGE_STAGES.next,
      tokenHash: nextHash,
      oldVerifiedAt: now,
      expiresAt: expiresAt(now),
    },
  });
  if (updated.count !== 1) throw invalidRequest();
  return { verified: true as const, next: "new-email" as const };
}

export async function verifyNewEmailChange(request: Request, token: string) {
  const tokenHash = hashEmailChangeToken(token);
  let completed:
    | { userId: string; name: string; oldEmail: string; newEmail: string }
    | undefined;
  try {
    completed = await prisma.$transaction(
      async (tx) => {
        const pending = await tx.emailChangeRequest.findUnique({
          where: { tokenHash },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        const now = new Date();
        if (
          !pending ||
          pending.stage !== EMAIL_CHANGE_STAGES.next ||
          !pending.oldVerifiedAt ||
          pending.expiresAt <= now ||
          pending.user.email.toLowerCase() !== pending.oldEmail
        ) {
          throw invalidRequest();
        }
        const conflict = await tx.user.findFirst({
          where: {
            id: { not: pending.userId },
            email: { equals: pending.newEmail, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (conflict) throw invalidRequest();

        const changed = await tx.user.updateMany({
          where: {
            id: pending.userId,
            email: { equals: pending.oldEmail, mode: "insensitive" },
          },
          data: { email: pending.newEmail, emailVerified: true },
        });
        if (changed.count !== 1) throw invalidRequest();

        await tx.session.deleteMany({ where: { userId: pending.userId } });
        await tx.verification.deleteMany({ where: { value: pending.userId } });
        await tx.emailChangeRequest.delete({ where: { id: pending.id } });
        await tx.activityLog.create({
          data: activityRecordData(request, pending.userId, "EMAIL_CHANGED"),
        });
        return {
          userId: pending.userId,
          name: pending.user.name,
          oldEmail: pending.oldEmail,
          newEmail: pending.newEmail,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      error instanceof ApiError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2025", "P2034"].includes(error.code))
    ) {
      throw invalidRequest();
    }
    throw error;
  }

  void sendEmailChangeCompletedNotifications(completed).catch(() => {
    console.error(JSON.stringify({ event: "email-change-notification-failed" }));
  });
  return { changed: true as const, email: completed.newEmail };
}
