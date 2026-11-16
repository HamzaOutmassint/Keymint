export const EMAIL_CHANGE_STAGES = {
  current: "VERIFY_CURRENT_EMAIL",
  next: "VERIFY_NEW_EMAIL",
} as const;

export type EmailChangeStage =
  (typeof EMAIL_CHANGE_STAGES)[keyof typeof EMAIL_CHANGE_STAGES];

export const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;
export const EMAIL_CHANGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
