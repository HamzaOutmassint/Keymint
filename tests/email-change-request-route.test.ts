import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    TestApiError,
    sameOrigin: vi.fn(),
    rateLimit: vi.fn(),
    verifyPassword: vi.fn(),
    start: vi.fn(),
  };
});

vi.mock("@/server/http", () => ({
  ApiError: mocks.TestApiError,
  assertSameOrigin: mocks.sameOrigin,
  requireSession: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    },
  }),
  parseJson: async (request: Request) => request.json(),
  ok: (data: unknown) => Response.json({ data }),
  handleApiError: (error: unknown) =>
    error instanceof mocks.TestApiError
      ? Response.json({ error: error.message }, { status: error.status })
      : Response.json({ error: "unexpected" }, { status: 500 }),
}));
vi.mock("@/server/rate-limit", () => ({ assertRateLimit: mocks.rateLimit }));
vi.mock("@/server/security/reauthentication", () => ({
  verifyAccountPassword: mocks.verifyPassword,
}));
vi.mock("@/server/security/email-change", () => ({
  startEmailChange: mocks.start,
  getPendingEmailChange: vi.fn(),
  cancelEmailChange: vi.fn(),
}));

import { POST } from "@/app/api/security/email-change/request/route";

function emailChangeRequest() {
  return new Request("http://localhost/api/security/email-change/request", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: JSON.stringify({
      newEmail: "new@example.test",
      password: "current login password",
    }),
  });
}

describe("email-change initiation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue({ accepted: true });
  });

  it("rejects an incorrect login password before creating a request", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(emailChangeRequest());
    expect(response.status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("applies both rate limits and passes verified account state to the ceremony", async () => {
    mocks.verifyPassword.mockResolvedValue(true);
    const request = emailChangeRequest();
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.sameOrigin).toHaveBeenCalledWith(request);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.start).toHaveBeenCalledWith({
      request,
      user: {
        id: "user-1",
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
      },
      newEmail: "new@example.test",
    });
  });
});
