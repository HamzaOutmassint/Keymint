import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISABLED_AUTH_PATHS } from "@/lib/security-policy";
import { escapeHtml } from "@/server/email";

const profileRoute = readFileSync("app/api/profile/route.ts", "utf8");
const settings = readFileSync("app/(vault)/settings/page.tsx", "utf8");
const verificationPage = readFileSync(
  "app/(auth)/verify-email-change/page.tsx",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260804210000_secure_email_change/migration.sql",
  "utf8",
);

describe("email-change security contract", () => {
  it("keeps Better Auth's alternate email-change route disabled", () => {
    expect(DISABLED_AUTH_PATHS).toContain("/change-email");
  });

  it("keeps email out of ordinary profile writes", () => {
    expect(profileRoute).not.toContain("data: { email");
    expect(settings).not.toContain("email: currentProfileEmail");
  });

  it("uses an inert fragment link until the user explicitly confirms", () => {
    expect(verificationPage).toContain("window.location.hash");
    expect(verificationPage).toContain("window.history.replaceState");
    expect(verificationPage).toContain("onClick={verify}");
    const effect = verificationPage.slice(
      verificationPage.indexOf("useEffect(() =>"),
      verificationPage.indexOf("async function verify"),
    );
    expect(effect).not.toContain("api(");
  });

  it("enforces one request per user, hashed tokens, stages, and lowercased email identity", () => {
    expect(migration).toContain('"userId" TEXT NOT NULL');
    expect(migration).toContain('"EmailChangeRequest_userId_key"');
    expect(migration).toContain("^[a-f0-9]{64}$");
    expect(migration).toContain("VERIFY_CURRENT_EMAIL");
    expect(migration).toContain("VERIFY_NEW_EMAIL");
    expect(migration).toContain('LOWER("email")');
  });

  it("HTML-escapes user-controlled mail content", () => {
    expect(escapeHtml(`<Admin & "Owner">`)).toBe(
      "&lt;Admin &amp; &quot;Owner&quot;&gt;",
    );
  });
});
