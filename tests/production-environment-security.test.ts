import { describe, expect, it } from "vitest";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";

const validProductionEnvironment = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "auth_2b7Kq0mX9vLp4rTs8wYz6nCd3fGh5jUa",
  DATABASE_URL: "postgresql://keymint:strong-password@db.internal/keymint?sslmode=verify-full",
  BETTER_AUTH_URL: "https://vault.example.test",
  NEXT_PUBLIC_APP_URL: "https://vault.example.test",
  ENABLE_REGISTRATION: "false",
  ALLOW_DEMO_SEED: "false",
  RESEND_API_KEY: "re_live_7Xk2pQ9mR4sT8vW3yZ6a",
  RESEND_FROM_EMAIL: "Keymint <security@vault.example.test>",
};

describe("production environment security", () => {
  it("accepts a strong secret, PostgreSQL credentials, and HTTPS origins", () => {
    expect(
      resolveServerSecurityEnvironment(validProductionEnvironment),
    ).toMatchObject({
      authSecret: validProductionEnvironment.BETTER_AUTH_SECRET,
    });
  });

  it.each([
    ["missing values", { NODE_ENV: "production" }],
    [
      "plaintext origin",
      { ...validProductionEnvironment, BETTER_AUTH_URL: "http://vault.test" },
    ],
    [
      "default database credentials",
      {
        ...validProductionEnvironment,
        DATABASE_URL: "postgresql://keymint:keymint@db/keymint",
      },
    ],
    [
      "placeholder database password",
      {
        ...validProductionEnvironment,
        DATABASE_URL:
          "postgresql://keymint:replace-with-a-real-password@db/keymint",
      },
    ],
    [
      "placeholder secret",
      {
        ...validProductionEnvironment,
        BETTER_AUTH_SECRET: "development-only-secret-change-me-123456",
      },
    ],
    [
      "low-entropy secret",
      { ...validProductionEnvironment, BETTER_AUTH_SECRET: "a".repeat(48) },
    ],
    [
      "mismatched origins",
      {
        ...validProductionEnvironment,
        NEXT_PUBLIC_APP_URL: "https://other.example.test",
      },
    ],
    [
      "database TLS downgrade",
      {
        ...validProductionEnvironment,
        DATABASE_URL: "postgresql://keymint:strong-password@db/keymint?sslmode=prefer",
      },
    ],
    [
      "demo seed in production",
      { ...validProductionEnvironment, ALLOW_DEMO_SEED: "true" },
    ],
    [
      "invalid proxy boundary",
      { ...validProductionEnvironment, TRUSTED_PROXY_CIDRS: "10.0.0.0/8,not-a-cidr" },
    ],
    [
      "email sender header injection",
      {
        ...validProductionEnvironment,
        RESEND_FROM_EMAIL: "Keymint <security@vault.example.test>\r\nBcc: attacker.test",
      },
    ],
    [
      "ambiguous feature flag",
      { ...validProductionEnvironment, ENABLE_REGISTRATION: "yes" },
    ],
    [
      "unbounded readiness timeout",
      { ...validProductionEnvironment, READINESS_TIMEOUT_MS: "60000" },
    ],
  ])("rejects %s", (_name, environment) => {
    expect(() => resolveServerSecurityEnvironment(environment)).toThrow(
      "Unsafe production configuration",
    );
  });

  it("normalizes matching origins and accepts bounded readiness settings", () => {
    expect(
      resolveServerSecurityEnvironment({
        ...validProductionEnvironment,
        BETTER_AUTH_URL: "https://vault.example.test/",
        TRUSTED_PROXY_CIDRS: "10.0.0.0/8,2001:db8::/32",
        READINESS_TIMEOUT_MS: "2500",
      }),
    ).toMatchObject({
      authUrl: "https://vault.example.test",
      appUrl: "https://vault.example.test",
      readinessTimeoutMs: 2500,
    });
  });

  it("keeps known fallbacks limited to development", () => {
    expect(
      resolveServerSecurityEnvironment({ NODE_ENV: "development" }),
    ).toMatchObject({
      authUrl: "http://localhost:3000",
      appUrl: "http://localhost:3000",
    });
  });
});
