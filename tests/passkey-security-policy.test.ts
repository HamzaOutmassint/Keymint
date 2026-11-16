import { describe, expect, it } from "vitest";
import {
  DISABLED_AUTH_PATHS,
  REAUTHENTICATION_MAX_AGE_SECONDS,
  TRUST_DEVICE_MAX_AGE_SECONDS,
  trustedProxyIpPolicy,
} from "@/lib/security-policy";

describe("passkey security policy", () => {
  it("enables hardened passkey authentication and enrollment", () => {
    expect(DISABLED_AUTH_PATHS).not.toEqual(
      expect.arrayContaining([
        "/passkey/generate-register-options",
        "/passkey/verify-registration",
        "/passkey/generate-authenticate-options",
        "/passkey/verify-authentication",
      ]),
    );
  });

  it("disables the destructive library TOTP enrollment endpoint", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/two-factor/enable");
  });

  it("disables session-only library passkey deletion", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/passkey/delete-passkey");
  });

  it("uses a five-minute reauthentication window", () => {
    expect(REAUTHENTICATION_MAX_AGE_SECONDS).toBe(300);
  });

  it("limits trusted-device lifetime to fourteen days", () => {
    expect(TRUST_DEVICE_MAX_AGE_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it("does not trust forwarded IP headers without an explicit proxy boundary", () => {
    expect(trustedProxyIpPolicy("")).toEqual({
      ipAddressHeaders: [],
      trustedProxies: [],
    });
    expect(trustedProxyIpPolicy("127.0.0.1/32, ::1/128")).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["127.0.0.1/32", "::1/128"],
    });
  });
});
