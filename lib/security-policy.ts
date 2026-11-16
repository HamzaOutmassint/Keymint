// Unsafe library-level enrollment is replaced by Keymint's pending enrollment
// protocol. Passkey endpoints remain enabled because Keymint rejects ceremonies
// whose signed authenticator data does not contain the user-verification flag.
export const DISABLED_AUTH_PATHS = [
  // Keymint uses one-time database-backed current/new-address verification,
  // password confirmation, and full session revocation instead.
  "/change-email",
  "/two-factor/enable",
  // The library endpoint requires only an authenticated session. Keymint uses
  // its password-confirmed, owner-scoped endpoint for factor removal instead.
  "/passkey/delete-passkey",
] as const;

export const TRUST_DEVICE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
export const REAUTHENTICATION_MAX_AGE_SECONDS = 5 * 60;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ENROLLMENT_MAX_AGE_SECONDS = 10 * 60;

export function contentSecurityPolicy(nonce: string, production = process.env.NODE_ENV === "production") {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src-elem 'self'",
    // React and floating UI components use narrowly scoped style attributes
    // for user-selected colors and runtime positioning. Keep that exception
    // out of stylesheet elements so injected <style> blocks remain denied.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (production) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function trustedProxyIpPolicy(value = process.env.TRUSTED_PROXY_CIDRS) {
  const trustedProxies =
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  // Without an explicitly configured proxy boundary, Better Auth uses one
  // shared fail-safe bucket instead of trusting a client-supplied forwarding
  // header. The reverse proxy must overwrite/append X-Forwarded-For.
  return trustedProxies.length
    ? { ipAddressHeaders: ["x-forwarded-for"], trustedProxies }
    : { ipAddressHeaders: [] as string[], trustedProxies: [] as string[] };
}
