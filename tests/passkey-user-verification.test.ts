import { describe, expect, it } from "vitest";
import { assertPasskeyUserVerified } from "@/server/security/passkeys";

describe("passkey user verification", () => {
  it("accepts a ceremony only when the signed UV flag is true", () => {
    expect(() => assertPasskeyUserVerified(true)).not.toThrow();
  });

  it.each([false, undefined])("rejects missing user verification (%s)", (value) => {
    expect(() => assertPasskeyUserVerified(value)).toThrow(
      "This passkey did not verify the user",
    );
  });
});

