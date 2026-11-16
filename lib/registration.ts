export function isRegistrationEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.ENABLE_REGISTRATION === "true" &&
    Boolean(environment.RESEND_API_KEY)
  );
}
