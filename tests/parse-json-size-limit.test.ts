import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
let parseJson: typeof import("@/server/http").parseJson;

beforeAll(async () => {
  ({ parseJson } = await import("@/server/http"));
});

describe("bounded JSON parsing", () => {
  it("rejects a chunked body that exceeds the byte limit", async () => {
    const request = new Request("https://vault.example.test/api/test", {
      method: "POST",
      body: JSON.stringify({ value: "0123456789" }),
    });

    await expect(
      parseJson(request, z.object({ value: z.string() }), 10),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an invalid Content-Length before parsing", async () => {
    const request = new Request("https://vault.example.test/api/test", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "{}",
    });

    await expect(parseJson(request, z.object({}), 100)).rejects.toMatchObject({
      status: 400,
    });
  });
});
