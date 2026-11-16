import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const login = readFileSync("app/(auth)/login/page.tsx", "utf8");
const securityCenter = readFileSync("features/settings/security-center.tsx", "utf8");
const auth = readFileSync("lib/auth.ts", "utf8");
const passkeyRemoval = readFileSync("app/api/security/passkeys/delete/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const vaultSettings = readFileSync("app/(vault)/settings/page.tsx", "utf8");
const vaultUnlock = readFileSync("features/vault/unlock-gate.tsx", "utf8");
const resetPassword = readFileSync("app/(auth)/reset-password/page.tsx", "utf8");

describe("authentication surface", () => {
  it("offers both TOTP and single-use recovery-code login", () => {
    expect(login).toContain("verifyTotp");
    expect(login).toContain("verifyBackupCode");
    expect(login).toContain("Use a recovery code");
  });

  it("offers passkey sign-in and performs password reauthentication before enrollment", () => {
    expect(login).toContain("signIn.passkey");
    const reauth = securityCenter.indexOf('api("/api/security/reauth"');
    const enroll = securityCenter.indexOf("authClient.passkey.addPasskey");
    expect(reauth).toBeGreaterThan(-1);
    expect(enroll).toBeGreaterThan(reauth);
  });

  it("supports recovery-code replacement and session revocation", () => {
    expect(securityCenter).toContain("generateBackupCodes");
    expect(securityCenter).toContain("listSessions");
    expect(securityCenter).toContain("revokeSession");
    expect(securityCenter).toContain("revokeOtherSessions");
  });

  it("enforces UV after both signed passkey ceremonies", () => {
    expect(auth.match(/assertPasskeyUserVerified/g)).toHaveLength(3);
    expect(auth).toContain("registrationInfo?.userVerified");
    expect(auth).toContain("authenticationInfo.userVerified");
  });

  it("persists pending replacement and replay-protection state", () => {
    expect(schema).toContain("lastUsedTotpStep");
    expect(schema).toContain("pendingSecret");
    expect(schema).toContain("pendingBackupCodes");
    expect(schema).toContain("pendingExpiresAt");
  });

  it("wires notifications for factor and session changes", () => {
    for (const event of [
      "totp-disabled",
      "recovery-codes-regenerated",
      "passkey-added",
      "sessions-revoked",
    ]) expect(auth).toContain(event);
    expect(passkeyRemoval).toContain("passkey-removed");
  });

  it("aligns reset policy and confirms the login password before wrapper changes", () => {
    expect(resetPassword).toContain('min(12, "Use at least 12 characters")');
    expect(resetPassword).toContain('max(128, "Use no more than 128 characters")');
    expect(vaultSettings.indexOf('api("/api/security/reauth"')).toBeLessThan(
      vaultSettings.indexOf("vaultCryptoClient.createMasterRewrap"),
    );
    expect(vaultUnlock.indexOf('api("/api/security/reauth"')).toBeLessThan(
      vaultUnlock.indexOf('"/api/v2/vault/recovery"'),
    );
  });
});
