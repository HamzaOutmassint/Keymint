import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parsed: { id: "passkey-1", password: "correct password" },
  verifyPassword: vi.fn(),
  rateLimit: vi.fn(),
  transaction: vi.fn(),
  passkeyDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  verificationDeleteMany: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/server/http", async () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  return {
    ApiError,
    assertSameOrigin: vi.fn(),
    requireSession: vi.fn().mockResolvedValue({
      user: { id: "user-1" },
      session: { token: "current-token" },
    }),
    parseJson: vi.fn().mockImplementation(() => Promise.resolve(mocks.parsed)),
    ok: (data: unknown) => Response.json(
      { data },
      { headers: { "cache-control": "no-store" } },
    ),
    handleApiError: (error: unknown) => {
      const failure = error as { status?: number; message?: string };
      return Response.json(
        { error: failure.message ?? "Unexpected" },
        { status: failure.status ?? 500, headers: { "cache-control": "no-store" } },
      );
    },
  };
});
vi.mock("@/server/security/reauthentication", () => ({
  verifyAccountPassword: mocks.verifyPassword,
}));
vi.mock("@/server/rate-limit", () => ({ assertRateLimit: mocks.rateLimit }));
vi.mock("@/server/security/security-notifications", () => ({
  notifySecurityChange: mocks.notify,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { POST } from "@/app/api/security/passkeys/delete/route";

describe("passkey removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.passkeyDeleteMany.mockResolvedValue({ count: 1 });
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
    mocks.verificationDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      passkey: { deleteMany: mocks.passkeyDeleteMany },
      session: { deleteMany: mocks.sessionDeleteMany },
      verification: { deleteMany: mocks.verificationDeleteMany },
    }));
  });

  it("rate-limits password confirmation and rejects a wrong password", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(new Request(
      "http://localhost/api/security/passkeys/delete",
      { method: "POST" },
    ));
    expect(response.status).toBe(401);
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "security-password:user-1",
      "user-1",
      5,
      300,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deletes only an owned passkey and atomically revokes other access", async () => {
    const response = await POST(new Request(
      "http://localhost/api/security/passkeys/delete",
      { method: "POST" },
    ));
    expect(response.status).toBe(200);
    expect(mocks.passkeyDeleteMany).toHaveBeenCalledWith({
      where: { id: "passkey-1", userId: "user-1" },
    });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", token: { not: "current-token" } },
    });
    expect(mocks.verificationDeleteMany).toHaveBeenCalledWith({
      where: { value: "user-1" },
    });
    expect(mocks.notify).toHaveBeenCalledWith("user-1", "passkey-removed");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not reveal whether another user's passkey exists", async () => {
    mocks.passkeyDeleteMany.mockResolvedValue({ count: 0 });
    const response = await POST(new Request(
      "http://localhost/api/security/passkeys/delete",
      { method: "POST" },
    ));
    expect(response.status).toBe(404);
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
