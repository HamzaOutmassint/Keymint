import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const authResponse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: authResponse, POST: authResponse }),
}));

import { GET as authGet, POST as authPost } from "@/app/api/auth/[...all]/route";

describe("cache and logging controls", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["GET", authGet],
    ["POST", authPost],
  ] as const)("forces no-store on Better Auth %s responses", async (method, handler) => {
    authResponse.mockResolvedValueOnce(Response.json(
      { token: "sensitive" },
      { headers: { "x-upstream": "preserved" } },
    ));
    const response = await handler(new Request(
      "http://localhost/api/auth/get-session",
      { method },
    ) as never);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-upstream")).toBe("preserved");
  });

  it("applies no-store to nonce-bearing page responses", () => {
    const source = readFileSync("proxy.ts", "utf8");
    expect(source).toContain('response.headers.set("Cache-Control", "no-store, max-age=0")');
  });

  it("never logs provider exception text from best-effort notifications", () => {
    const source = readFileSync(
      "server/security/security-notifications.ts",
      "utf8",
    );
    expect(source).toContain('"security-notification-failed"');
    expect(source).not.toMatch(/catch\(\(error\).*error\.message/s);
  });
});
