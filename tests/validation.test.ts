import { describe, expect, it } from "vitest";
import { credentialSchema } from "@/features/credentials/schemas";
import { emailChangeRequestSchema, profileSchema } from "@/features/settings/schemas";

describe("server validation", () => {
  it("rejects malformed credential URLs", () => expect(credentialSchema.safeParse({ name: "A", username: "u", website: "not a url", password: "p", favorite: false, masterPassword: "long master password" }).success).toBe(false));
  it("keeps email changes out of the ordinary profile schema", () =>
    expect(
      profileSchema.safeParse({ name: "Ada Lovelace", email: "ada@example.test" })
        .success,
    ).toBe(false));
  it("normalizes a dedicated email-change request", () => {
    const result = emailChangeRequestSchema.parse({
      newEmail: "  ADA@EXAMPLE.TEST ",
      password: "current login password",
    });
    expect(result.newEmail).toBe("ada@example.test");
  });
});
