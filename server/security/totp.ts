import { timingSafeEqual } from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";
import {
  TOTP_ENROLLMENT_MAX_AGE_SECONDS,
  TOTP_PERIOD_SECONDS,
} from "@/lib/security-policy";

const AUTH_SECRET = resolveServerSecurityEnvironment().authSecret;

function sameCode(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateRecoveryCodes(amount = 10, length = 10) {
  return Array.from({ length: amount }, () => {
    const value = generateRandomString(length, "a-z", "0-9", "A-Z");
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

export async function encodeTotpSecret(secret: string) {
  return symmetricEncrypt({ key: AUTH_SECRET, data: secret });
}

export async function encodeRecoveryCodes(codes: string[]) {
  return symmetricEncrypt({ key: AUTH_SECRET, data: JSON.stringify(codes) });
}

export async function matchingTotpStep(
  encryptedSecret: string,
  code: string,
  now = Date.now(),
  window = 1,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = await symmetricDecrypt({ key: AUTH_SECRET, data: encryptedSecret });
  const current = Math.floor(now / (TOTP_PERIOD_SECONDS * 1_000));
  const otp = createOTP(secret, { digits: 6, period: TOTP_PERIOD_SECONDS });
  let match: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (sameCode(code, await otp.hotp(step))) match = step;
  }
  return match;
}

/** Atomically claims a signed TOTP time-step before Better Auth creates a session. */
export async function reserveTotpStep(userId: string, code: string, now = Date.now()) {
  const factor = await prisma.twoFactor.findUnique({
    where: { userId },
    select: { secret: true },
  });
  if (!factor) return "invalid" as const;
  const step = await matchingTotpStep(factor.secret, code, now);
  if (step === null) return "invalid" as const;
  const reserved = await prisma.twoFactor.updateMany({
    where: {
      userId,
      OR: [{ lastUsedTotpStep: null }, { lastUsedTotpStep: { lt: step } }],
    },
    data: { lastUsedTotpStep: step },
  });
  return reserved.count === 1 ? ("reserved" as const) : ("replayed" as const);
}

export async function beginTotpEnrollment(userId: string, email: string) {
  const secret = generateRandomString(32);
  const recoveryCodes = generateRecoveryCodes();
  const pendingSecret = await encodeTotpSecret(secret);
  const pendingBackupCodes = await encodeRecoveryCodes(recoveryCodes);
  const pendingExpiresAt = new Date(
    Date.now() + TOTP_ENROLLMENT_MAX_AGE_SECONDS * 1_000,
  );
  const existing = await prisma.twoFactor.findUnique({ where: { userId } });

  await prisma.twoFactor.upsert({
    where: { userId },
    update: { pendingSecret, pendingBackupCodes, pendingExpiresAt },
    // The inactive fields satisfy Better Auth's schema until verification. The
    // user flag remains false, so this record can never gate or complete login.
    create: {
        id: crypto.randomUUID(),
        userId,
        secret: pendingSecret,
        backupCodes: pendingBackupCodes,
        verified: false,
        pendingSecret,
        pendingBackupCodes,
        pendingExpiresAt,
    },
  });

  return {
    totpURI: createOTP(secret, {
      digits: 6,
      period: TOTP_PERIOD_SECONDS,
    }).url("Keymint", email),
    recoveryCodes,
    expiresAt: pendingExpiresAt.toISOString(),
    replacing: !!existing?.verified,
  };
}

export async function completeTotpEnrollment(
  userId: string,
  code: string,
  now = Date.now(),
) {
  const factor = await prisma.twoFactor.findUnique({ where: { userId } });
  if (
    !factor?.pendingSecret ||
    !factor.pendingBackupCodes ||
    !factor.pendingExpiresAt ||
    factor.pendingExpiresAt.getTime() <= now
  ) {
    return "expired" as const;
  }
  const step = await matchingTotpStep(factor.pendingSecret, code, now);
  if (step === null) return "invalid" as const;

  return prisma.$transaction(async (tx) => {
    const promoted = await tx.twoFactor.updateMany({
      where: {
        id: factor.id,
        pendingSecret: factor.pendingSecret,
        pendingExpiresAt: { gt: new Date(now) },
      },
      data: {
        secret: factor.pendingSecret!,
        backupCodes: factor.pendingBackupCodes!,
        verified: true,
        lastUsedTotpStep: step,
        pendingSecret: null,
        pendingBackupCodes: null,
        pendingExpiresAt: null,
        failedVerificationCount: 0,
        lockedUntil: null,
      },
    });
    if (promoted.count !== 1) return "conflict" as const;
    await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    return "completed" as const;
  });
}
