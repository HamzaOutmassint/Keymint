import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
let ApiError: typeof import("@/server/http").ApiError;
let handleApiError: typeof import("@/server/http").handleApiError;

beforeAll(async () => {
  ({ ApiError, handleApiError } = await import("@/server/http"));
});

describe("API error cache policy", () => {
  it("marks application errors no-store", () => {
    const response = handleApiError(new ApiError(403, "Rejected"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves a thrown response while adding no-store", async () => {
    const response = handleApiError(
      new Response("limited", {
        status: 429,
        headers: { "retry-after": "60" },
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("limited");
  });
});
