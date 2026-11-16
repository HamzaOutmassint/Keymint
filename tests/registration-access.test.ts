import { describe, expect, it } from "vitest";
import { isRegistrationEnabled } from "@/lib/registration";

describe("registration access", () => {
  it("is disabled by default", () => {
    expect(isRegistrationEnabled({})).toBe(false);
  });

  it("requires both explicit enablement and an email provider", () => {
    expect(isRegistrationEnabled({ ENABLE_REGISTRATION: "true" })).toBe(false);
    expect(
      isRegistrationEnabled({
        ENABLE_REGISTRATION: "true",
        RESEND_API_KEY: "configured",
      }),
    ).toBe(true);
    expect(
      isRegistrationEnabled({
        ENABLE_REGISTRATION: "false",
        RESEND_API_KEY: "configured",
      }),
    ).toBe(false);
  });
});
