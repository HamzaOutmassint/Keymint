export const RETENTION_DAYS = {
  activityLogs: 90,
  mutationReceipts: 7,
  rateLimits: 2,
} as const;

export function retentionCutoff(days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1) throw new TypeError("Retention days must be a positive integer");
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
