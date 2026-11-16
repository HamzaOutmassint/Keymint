import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("security boundary claims", () => {
  it("describes the V2 boundary without claiming retroactive zero knowledge", async () => {
    const [readme, securityModel, metadata, revealUi, loginUi, settingsUi] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("docs/security-model.md", "utf8"),
      readFile("app/layout.tsx", "utf8"),
      readFile("features/credentials/credential-row.tsx", "utf8"),
      readFile("app/(auth)/login/page.tsx", "utf8"),
      readFile("app/(vault)/settings/page.tsx", "utf8"),
    ]);

    expect(securityModel).toContain("The Master Password is never part of a V2 request");
    expect(securityModel).toContain("Do not claim retroactive zero knowledge");
    expect(readme.toLowerCase()).not.toMatch(/zero[- ]knowledge/);
    expect(metadata).not.toContain("zero-knowledge encrypted password vault");
    expect(revealUi).not.toContain("verified locally");
    expect(loginUi).not.toContain("trustDevice: true");
    expect(settingsUi).not.toContain("trustDevice: true");
    expect(loginUi).toContain("checked={trustDevice}");
  });

  it("hashes new authentication verification identifiers", async () => {
    const authSource = await readFile("lib/auth.ts", "utf8");

    expect(authSource).toContain('storeIdentifier: "hashed"');
    expect(authSource).toContain("revokeSessionsOnPasswordReset: true");
    expect(authSource).toContain("revokeVerificationStateAfterPasswordReset");
    expect(authSource).toContain('storage: "database"');
    expect(authSource).toContain("requireEmailVerification: true");
    expect(authSource).toContain("sendVerificationEmail");
  });
});
