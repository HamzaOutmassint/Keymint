import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError: TestApiError, update: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: mocks.update } },
}));
vi.mock("@/server/http", () => ({
  ApiError: mocks.ApiError,
  assertSameOrigin: vi.fn(),
  requireSession: async () => ({
    user: { id: "user-1", email: "owner@example.test" },
  }),
  parseJson: async (request: Request, schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }) => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new mocks.ApiError(400, "Validation failed");
    return parsed.data;
  },
  ok: (data: unknown) => Response.json({ data }),
  handleApiError: (error: unknown) =>
    error instanceof mocks.ApiError
      ? Response.json({ error: error.message }, { status: error.status })
      : Response.json({ error: "unexpected" }, { status: 500 }),
}));

import { PATCH } from "@/app/api/profile/route";

describe("profile email security", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.update.mockResolvedValue({
      id: "user-1",
      name: "Owner Updated",
      email: "owner@example.test",
      image: null,
    });
  });

  it("rejects a session-only email change before any database write", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Owner",
          email: "attacker@example.test",
          image: "",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("continues to allow non-email profile edits", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Owner Updated",
          image: "",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { name: "Owner Updated", image: null },
      }),
    );
  });
});
