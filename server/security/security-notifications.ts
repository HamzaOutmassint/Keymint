import { prisma } from "@/lib/prisma";
import { escapeHtml, sendTransactionalEmail } from "@/server/email";

export type SecurityNotification =
  | "totp-enabled"
  | "totp-replaced"
  | "totp-disabled"
  | "recovery-codes-regenerated"
  | "recovery-code-used"
  | "passkey-added"
  | "passkey-removed"
  | "sessions-revoked";

const copy: Record<SecurityNotification, { subject: string; summary: string }> = {
  "totp-enabled": { subject: "Authenticator protection enabled", summary: "An authenticator app was added to your Keymint account." },
  "totp-replaced": { subject: "Authenticator replaced", summary: "The authenticator app on your Keymint account was replaced." },
  "totp-disabled": { subject: "Authenticator protection disabled", summary: "Authenticator-app protection was removed from your Keymint account." },
  "recovery-codes-regenerated": { subject: "Recovery codes replaced", summary: "New recovery codes were generated. Every previous recovery code is now invalid." },
  "recovery-code-used": { subject: "Recovery code used to sign in", summary: "One recovery code was used to sign in to your Keymint account." },
  "passkey-added": { subject: "Passkey added", summary: "A new passkey was added to your Keymint account." },
  "passkey-removed": { subject: "Passkey removed", summary: "A passkey was removed from your Keymint account." },
  "sessions-revoked": { subject: "Sessions revoked", summary: "One or more signed-in devices were removed from your Keymint account." },
};

/** Notifications are best-effort: an email outage must not roll back a security change. */
export async function sendSecurityNotification(
  userId: string,
  event: SecurityNotification,
) {
  if (!process.env.RESEND_API_KEY) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) return false;
  const message = copy[event];
  try {
    await sendTransactionalEmail({
      to: user.email,
      subject: message.subject,
      html: `<p>Hello ${escapeHtml(user.name)},</p><p>${escapeHtml(message.summary)}</p><p>If this was not you, change your login password and revoke your sessions immediately.</p>`,
    });
  } catch {
    throw new Error("Unable to send security notification");
  }
  return true;
}

export function notifySecurityChange(userId: string, event: SecurityNotification) {
  void sendSecurityNotification(userId, event).catch(() => {
    // Provider responses can contain addresses, request IDs, or other
    // operational details. Emit only a stable event name.
    console.error(JSON.stringify({ event: "security-notification-failed" }));
  });
}
