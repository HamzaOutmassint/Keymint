import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { sendSecurityNotification } from "@/server/security/security-notifications";

describe("security notifications", () => {
  const previousKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({
      email: "person@example.com",
      name: "<Key Owner>",
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-1" }, error: null });
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  });

  it("does no provider or database work when delivery is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendSecurityNotification("user-1", "passkey-added")).resolves.toBe(false);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends escaped, secret-free change details to the account address", async () => {
    process.env.RESEND_API_KEY = "test-key";
    await expect(sendSecurityNotification("user-1", "recovery-codes-regenerated")).resolves.toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      subject: "Recovery codes replaced",
      html: expect.stringContaining("&lt;Key Owner&gt;"),
    }));
    const message = JSON.stringify(mocks.send.mock.calls[0][0]);
    expect(message).not.toMatch(/AAAAA-BBBBB|current-token|credentialID/);
  });

  it("surfaces provider failures to the best-effort wrapper", async () => {
    process.env.RESEND_API_KEY = "test-key";
    mocks.send.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(sendSecurityNotification("user-1", "sessions-revoked")).rejects.toThrow(
      "Unable to send security notification",
    );
  });
});
