import { prisma } from "@/lib/prisma";
import { RETENTION_DAYS, retentionCutoff } from "@/lib/retention-policy";

/** Applies the documented data-minimization windows without accepting user input. */
export async function enforceOperationalRetention(now = new Date()) {
  const activityCutoff = retentionCutoff(RETENTION_DAYS.activityLogs, now);
  const mutationCutoff = retentionCutoff(RETENTION_DAYS.mutationReceipts, now);
  const rateLimitCutoff = retentionCutoff(RETENTION_DAYS.rateLimits, now);

  const [activityLogs, verificationRecords, emailChangeRequests, rateLimitBuckets, authRateLimits, mutationReceipts] =
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { timestamp: { lt: activityCutoff } } }),
      prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.emailChangeRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: rateLimitCutoff } } }),
      prisma.rateLimit.deleteMany({ where: { lastRequest: { lt: BigInt(rateLimitCutoff.getTime()) } } }),
      prisma.vaultMutation.deleteMany({ where: { createdAt: { lt: mutationCutoff } } }),
    ]);

  return {
    activityLogs: activityLogs.count,
    verificationRecords: verificationRecords.count,
    emailChangeRequests: emailChangeRequests.count,
    rateLimitBuckets: rateLimitBuckets.count,
    authRateLimits: authRateLimits.count,
    mutationReceipts: mutationReceipts.count,
  };
}

export async function enforceUserActivityRetention(userId: string, now = new Date()) {
  return prisma.activityLog.deleteMany({
    where: {
      userId,
      timestamp: { lt: retentionCutoff(RETENTION_DAYS.activityLogs, now) },
    },
  });
}
