import { Resend } from "resend";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Email delivery is not configured");
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "Keymint <onboarding@resend.dev>",
    to,
    subject,
    html,
  });
  if (error) throw new Error("Email delivery failed");
}
