import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/security/password-hashing";

describe("login password hashing", () => {
  it("uses an Argon2id encoded hash and verifies without plaintext storage", async () => {
    const hash = await hashPassword("a-login-password");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("a-login-password");
    await expect(verifyPassword({ hash, password: "a-login-password" })).resolves.toBe(true);
  }, 10_000);
});
