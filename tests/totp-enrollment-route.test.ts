import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parsed: { password: "correct password" } as Record<string, string>,
  verifyPassword: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  revoke: vi.fn(),
  notify: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/server/http", async () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    assertSameOrigin: vi.fn(),
    requireSession: vi.fn().mockResolvedValue({
      user: { id: "user-1", email: "person@example.com", twoFactorEnabled: true },
      session: { token: "current-token" },
    }),
    parseJson: vi.fn().mockImplementation(() => Promise.resolve(mocks.parsed)),
    ok: (data: unknown) => Response.json({ data }, { headers: { "cache-control": "no-store" } }),
    handleApiError: (error: unknown) => {
      const failure = error as { status?: number; message?: string };
      return Response.json(
        { error: failure.message ?? "Unexpected" },
        { status: failure.status ?? 500, headers: { "cache-control": "no-store" } },
      );
    },
  };
});
vi.mock("@/server/security/reauthentication", () => ({ verifyAccountPassword: mocks.verifyPassword }));
vi.mock("@/server/security/totp", () => ({ beginTotpEnrollment: mocks.begin, completeTotpEnrollment: mocks.complete }));
vi.mock("@/server/security/auth-lifecycle", () => ({ revokeUserAccessAfterTwoFactorChange: mocks.revoke }));
vi.mock("@/server/security/security-notifications", () => ({ notifySecurityChange: mocks.notify }));
vi.mock("@/server/rate-limit", () => ({ assertRateLimit: mocks.rateLimit }));

import { POST, PUT } from "@/app/api/security/totp/enrollment/route";

describe("TOTP enrollment route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parsed = { password: "correct password" };
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.begin.mockResolvedValue({ replacing: true, recoveryCodes: ["AAAAA-BBBBB"] });
    mocks.complete.mockResolvedValue("completed");
    mocks.revoke.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue(undefined);
  });

  it("requires the current login password before staging material", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(new Request("http://localhost/api/security/totp/enrollment", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "security-password:user-1",
      "user-1",
      5,
      300,
    );
  });

  it("stages an enrollment without exposing active database material", async () => {
    const response = await POST(new Request("http://localhost/api/security/totp/enrollment", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.begin).toHaveBeenCalledWith("user-1", "person@example.com");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["invalid", 401],
    ["expired", 410],
    ["conflict", 409],
  ] as const)("maps %s completion to %s", async (status, expected) => {
    mocks.parsed = { code: "123456" };
    mocks.complete.mockResolvedValue(status);
    const response = await PUT(new Request("http://localhost/api/security/totp/enrollment", { method: "PUT" }));
    expect(response.status).toBe(expected);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("preserves the current session, revokes other access, and notifies after promotion", async () => {
    mocks.parsed = { code: "123456" };
    const response = await PUT(new Request("http://localhost/api/security/totp/enrollment", { method: "PUT" }));
    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith("user-1", "current-token");
    expect(mocks.notify).toHaveBeenCalledWith("user-1", "totp-replaced");
  });
});
