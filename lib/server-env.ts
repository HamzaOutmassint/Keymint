import { isIP } from "node:net";

const DEVELOPMENT_AUTH_SECRET =
  "development-only-better-auth-secret-change-me";
const DEVELOPMENT_DATABASE_URL =
  "postgresql://keymint:keymint@localhost:5432/keymint";
const DEVELOPMENT_APP_URL = "http://localhost:3000";
const DEFAULT_READINESS_TIMEOUT_MS = 5_000;

type Environment = Record<string, string | undefined>;

export type ServerSecurityEnvironment = {
  authSecret: string;
  databaseUrl: string;
  authUrl: string;
  appUrl: string;
  readinessTimeoutMs: number;
};

function isPlaceholder(value: string) {
  const normalized = value.toLowerCase();
  return [
    "change-me",
    "changeme",
    "replace-with",
    "development-only",
    "example-",
    "example_",
    "placeholder",
  ].some((part) => normalized.includes(part));
}

function parseHttpsOrigin(
  name: string,
  value: string | undefined,
  errors: string[],
) {
  if (!value) {
    errors.push(`${name} is required`);
    return;
  }
  try {
    if (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
      errors.push(`${name} must be a valid HTTPS origin`);
      return;
    }
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      errors.push(`${name} must be an HTTPS origin without a path`);
      return;
    }
    return url.origin;
  } catch {
    errors.push(`${name} must be a valid HTTPS origin`);
  }
}

function validateSecret(
  name: string,
  value: string | undefined,
  errors: string[],
) {
  if (!value) {
    errors.push(`${name} is required`);
    return;
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  const distinctCharacters = new Set(value).size;
  if (byteLength < 32 || isPlaceholder(value)) {
    errors.push(`${name} must be at least 32 bytes and non-placeholder`);
  } else if (distinctCharacters < 8 || /[\u0000-\u001f\u007f]/u.test(value)) {
    errors.push(`${name} must be randomly generated and contain no control characters`);
  }
}

function validateDatabaseUrl(value: string | undefined, errors: string[]) {
  if (!value) {
    errors.push("DATABASE_URL is required");
    return;
  }
  try {
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      errors.push("DATABASE_URL must not contain control characters");
      return;
    }
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      errors.push("DATABASE_URL must use PostgreSQL");
    }
    if (!url.username || !url.password) {
      errors.push("DATABASE_URL must include non-empty credentials");
    }
    if (!url.pathname || url.pathname === "/") {
      errors.push("DATABASE_URL must select a database");
    }
    if (
      url.username.toLowerCase() === "keymint" &&
      url.password === "keymint"
    ) {
      errors.push("DATABASE_URL must not use the documented default credentials");
    }
    if (isPlaceholder(decodeURIComponent(url.password))) {
      errors.push("DATABASE_URL must not use a placeholder password");
    }

    // A missing SSL option can be valid when a local socket or an authenticated
    // sidecar supplies transport security. Explicit downgrade settings are never
    // accepted in production.
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode && !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      errors.push("DATABASE_URL must not permit a plaintext TLS fallback");
    }
    if (url.searchParams.get("ssl")?.toLowerCase() === "false") {
      errors.push("DATABASE_URL must not explicitly disable TLS");
    }
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL URL");
  }
}

function validateBooleanFlag(
  name: string,
  value: string | undefined,
  errors: string[],
) {
  if (value !== undefined && value !== "true" && value !== "false") {
    errors.push(`${name} must be either true or false`);
  }
}

function validateEmailDelivery(environment: Environment, errors: string[]) {
  const apiKey = environment.RESEND_API_KEY;
  if (!apiKey || isPlaceholder(apiKey) || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
    errors.push("RESEND_API_KEY is required and must be non-placeholder");
  }

  const from = environment.RESEND_FROM_EMAIL;
  const address = from?.match(/(?:^|<)([^<>\s]+@[^<>\s]+)(?:>|$)/)?.[1];
  if (
    !from ||
    /[\u0000-\u001f\u007f]/u.test(from) ||
    !address ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(address)
  ) {
    errors.push("RESEND_FROM_EMAIL must contain a valid sender address");
  } else if (isPlaceholder(from) || address.toLowerCase().endsWith(".example")) {
    errors.push("RESEND_FROM_EMAIL must be non-placeholder");
  }
}

function validateTrustedProxyCidrs(value: string | undefined, errors: string[]) {
  if (!value) return;
  for (const entry of value.split(",").map((item) => item.trim())) {
    const match = entry.match(/^(.+)\/(\d{1,3})$/u);
    const address = match?.[1];
    const prefix = Number(match?.[2]);
    const version = address ? isIP(address) : 0;
    if (
      !match ||
      !version ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      (version === 4 && prefix > 32) ||
      (version === 6 && prefix > 128)
    ) {
      errors.push("TRUSTED_PROXY_CIDRS contains an invalid CIDR entry");
    }
  }
}

function readinessTimeout(value: string | undefined, errors: string[]) {
  if (value === undefined) return DEFAULT_READINESS_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 250 || parsed > 30_000) {
    errors.push("READINESS_TIMEOUT_MS must be an integer from 250 to 30000");
    return DEFAULT_READINESS_TIMEOUT_MS;
  }
  return parsed;
}

/** Validate all settings needed by a production process, regardless of NODE_ENV. */
export function validateProductionConfiguration(
  environment: Environment = process.env,
): ServerSecurityEnvironment {
  const errors: string[] = [];
  validateSecret("BETTER_AUTH_SECRET", environment.BETTER_AUTH_SECRET, errors);
  validateDatabaseUrl(environment.DATABASE_URL, errors);
  const authUrl = parseHttpsOrigin("BETTER_AUTH_URL", environment.BETTER_AUTH_URL, errors);
  const appUrl = parseHttpsOrigin(
    "NEXT_PUBLIC_APP_URL",
    environment.NEXT_PUBLIC_APP_URL,
    errors,
  );
  if (authUrl && appUrl && authUrl !== appUrl) {
    errors.push("BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL must use the same origin");
  }

  validateBooleanFlag("ENABLE_REGISTRATION", environment.ENABLE_REGISTRATION, errors);
  validateBooleanFlag("ALLOW_DEMO_SEED", environment.ALLOW_DEMO_SEED, errors);
  if (environment.ALLOW_DEMO_SEED === "true") {
    errors.push("ALLOW_DEMO_SEED must not be enabled in production");
  }
  validateEmailDelivery(environment, errors);
  validateTrustedProxyCidrs(environment.TRUSTED_PROXY_CIDRS, errors);
  const readinessTimeoutMs = readinessTimeout(
    environment.READINESS_TIMEOUT_MS,
    errors,
  );

  if (errors.length) {
    throw new Error(`Unsafe production configuration: ${errors.join("; ")}`);
  }

  return {
    authSecret: environment.BETTER_AUTH_SECRET!,
    databaseUrl: environment.DATABASE_URL!,
    authUrl: authUrl!,
    appUrl: appUrl!,
    readinessTimeoutMs,
  };
}

export function resolveServerSecurityEnvironment(
  environment: Environment = process.env,
): ServerSecurityEnvironment {
  const enforceProduction =
    environment.NODE_ENV === "production" &&
    environment.NEXT_PHASE !== "phase-production-build";

  if (enforceProduction) return validateProductionConfiguration(environment);

  const errors: string[] = [];
  return {
    authSecret: environment.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET,
    databaseUrl: environment.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
    authUrl: environment.BETTER_AUTH_URL ?? DEVELOPMENT_APP_URL,
    appUrl: environment.NEXT_PUBLIC_APP_URL ?? DEVELOPMENT_APP_URL,
    readinessTimeoutMs: readinessTimeout(
      environment.READINESS_TIMEOUT_MS,
      errors,
    ),
  };
}
