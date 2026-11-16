import { prisma } from "@/lib/prisma";

/**
 * Invalidate reset links, pending 2FA challenges, and trusted-device records
 * that Better Auth associates with this user. Better Auth separately revokes
 * all sessions after this callback completes.
 */
export async function revokeVerificationStateAfterPasswordReset(
  userId: string,
) {
  await prisma.verification.deleteMany({ where: { value: userId } });
}

/**
 * A factor change invalidates every authenticated session and every
 * user-associated verification record, including trusted-device grants.
 */
export async function revokeUserAccessAfterTwoFactorChange(
  userId: string,
  preserveSessionToken?: string,
) {
  await prisma.$transaction([
    prisma.session.deleteMany({
      where: {
        userId,
        ...(preserveSessionToken ? { token: { not: preserveSessionToken } } : {}),
      },
    }),
    prisma.verification.deleteMany({ where: { value: userId } }),
  ]);
}
