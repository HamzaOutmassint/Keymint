import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
describe("API authentication", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects unauthenticated encrypted record listing", async () => {
    const { GET } = await import("@/app/api/v2/vault/sync/route");
    const response = await GET(new Request("http://localhost/api/v2/vault/sync?cursor=0", {
      headers: { "Keymint-Vault-Protocol": "2" },
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Authentication required" });
  });
});
