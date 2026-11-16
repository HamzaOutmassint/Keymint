import { resolveServerSecurityEnvironment } from "@/lib/server-env";
import { escapeHtml, sendTransactionalEmail } from "@/server/email";

function verificationUrl(stage: "current" | "new", token: string) {
  const base = resolveServerSecurityEnvironment().appUrl;
  const fragment = new URLSearchParams({ stage, token }).toString();
  return `${base}/verify-email-change#${fragment}`;
}

export async function sendCurrentEmailChangeVerification({
  name,
  oldEmail,
  newEmail,
  token,
}: {
  name: string;
  oldEmail: string;
  newEmail: string;
  token: string;
}) {
  const url = verificationUrl("current", token);
  await sendTransactionalEmail({
    to: oldEmail,
    subject: "Confirm your Keymint email change",
    html: `<p>Hello ${escapeHtml(name)},</p><p>Confirm that you want to change your Keymint sign-in email to <strong>${escapeHtml(newEmail)}</strong>.</p><p><a href="${escapeHtml(url)}">Confirm email change</a></p><p>This link expires in one hour. Your email has not changed yet. If you did not request this, ignore this message and review your signed-in devices.</p>`,
  });
}

export async function sendNewEmailChangeVerification({
  name,
  newEmail,
  token,
}: {
  name: string;
  newEmail: string;
  token: string;
}) {
  const url = verificationUrl("new", token);
  await sendTransactionalEmail({
    to: newEmail,
    subject: "Verify your new Keymint email address",
    html: `<p>Hello ${escapeHtml(name)},</p><p>The current address was confirmed. Verify this address to finish changing your Keymint sign-in email.</p><p><a href="${escapeHtml(url)}">Verify new email address</a></p><p>This link expires in one hour. Finishing the change will sign out every Keymint session.</p>`,
  });
}

export async function sendEmailChangeCompletedNotifications({
  name,
  oldEmail,
  newEmail,
}: {
  name: string;
  oldEmail: string;
  newEmail: string;
}) {
  const safeName = escapeHtml(name);
  const safeNewEmail = escapeHtml(newEmail);
  const results = await Promise.allSettled([
    sendTransactionalEmail({
      to: oldEmail,
      subject: "Your Keymint email address was changed",
      html: `<p>Hello ${safeName},</p><p>Your Keymint sign-in email was changed to <strong>${safeNewEmail}</strong>. Every signed-in device was removed.</p><p>If this was not you, contact the Keymint security owner immediately.</p>`,
    }),
    sendTransactionalEmail({
      to: newEmail,
      subject: "Your new Keymint email address is active",
      html: `<p>Hello ${safeName},</p><p><strong>${safeNewEmail}</strong> is now your Keymint sign-in email. Every previous session was removed; sign in again to continue.</p>`,
    }),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("One or more email-change notifications failed");
  }
}
