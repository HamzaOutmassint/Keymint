import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const base = {
    protected: {
      cipher: "A256GCM",
      format: "keymint-wrapped-vault-key",
      keyVersion: 1,
      ownerId: "user-1",
      protocolVersion: 2,
      vaultId: "58a3491e-a5b4-481b-9d67-5f691939655b",
      wrapVersion: 1,
    },
    nonce: "AAAAAAAAAAAAAAAA",
    ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  const master = {
    ...base,
    protected: { ...base.protected, purpose: "master", wrapRevision: "2" },
  };
  const recovery = {
    ...base,
    protected: { ...base.protected, purpose: "recovery", wrapRevision: "2" },
  };
  return {
    TestApiError,
    master,
    recovery,
    replaceMasterWrapper: vi.fn(async () => master),
    replaceRecoveryWrappers: vi.fn(async () => ({ masterWrapper: master, recoveryWrapper: recovery })),
    getVaultRecoveryMaterial: vi.fn(async () => ({ masterWrapper: master, recoveryWrapper: recovery })),
  };
});

vi.mock("@/server/http", () => ({
  assertSameOrigin: (request: Request) => {
    if (request.headers.get("origin") !== "http://localhost") throw new mocks.TestApiError(403, "Invalid origin");
  },
  assertVaultProtocolV2: (request: Request) => {
    if (request.headers.get("Keymint-Vault-Protocol") !== "2") throw new mocks.TestApiError(426, "Protocol required");
  },
  requireSession: async () => ({ user: { id: "user-1" }, session: { createdAt: new Date() } }),
  assertFreshAccountAuthentication: vi.fn(),
  parseJson: async (request: Request, schema: { parse(value: unknown): unknown }) => schema.parse(await request.json()),
  ok: (data: unknown) => Response.json({ data }, { headers: { "cache-control": "no-store" } }),
  handleApiError: (error: unknown) => {
    if (error instanceof mocks.TestApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Validation failed" }, { status: 400 });
    return Response.json({ error: "unexpected" }, { status: 500 });
  },
}));

vi.mock("@/server/v2-vault", () => ({
  replaceMasterWrapper: mocks.replaceMasterWrapper,
  replaceRecoveryWrappers: mocks.replaceRecoveryWrappers,
  getVaultRecoveryMaterial: mocks.getVaultRecoveryMaterial,
}));

import { PUT as PUT_MASTER } from "@/app/api/v2/vault/wrappers/master/route";
import { GET as GET_RECOVERY, PUT as PUT_RECOVERY } from "@/app/api/v2/vault/recovery/route";

function request(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "Keymint-Vault-Protocol": "2",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("opaque wrapper API integration", () => {
  it("returns recovery material without returning or accepting a Recovery Key", async () => {
    const response = await GET_RECOVERY(request("/api/v2/vault/recovery", "GET"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("ciphertext");
    expect(text).not.toMatch(/recoveryKey|masterPassword|credential-secret/);
  });

  it("changes the master wrapper without receiving a password or record ciphertext", async () => {
    const response = await PUT_MASTER(request(
      "/api/v2/vault/wrappers/master",
      "PUT",
      { masterWrapper: mocks.master },
    ));
    expect(response.status).toBe(200);
    expect(mocks.replaceMasterWrapper).toHaveBeenCalledWith("user-1", mocks.master);
    const serializedCall = JSON.stringify(mocks.replaceMasterWrapper.mock.calls);
    expect(serializedCall).not.toMatch(/masterPassword|recoveryKey|recordId/);
  });

  it("atomically delegates both recovery wrapper replacements", async () => {
    const response = await PUT_RECOVERY(request(
      "/api/v2/vault/recovery",
      "PUT",
      { masterWrapper: mocks.master, recoveryWrapper: mocks.recovery },
    ));
    expect(response.status).toBe(200);
    expect(mocks.replaceRecoveryWrappers).toHaveBeenCalledWith(
      "user-1",
      mocks.master,
      mocks.recovery,
    );
    expect(JSON.stringify(mocks.replaceRecoveryWrappers.mock.calls)).not.toMatch(
      /masterPassword|recoveryKey|credential-secret/,
    );
  });

  it("rejects unknown request fields before wrapper mutation", async () => {
    const response = await PUT_RECOVERY(request(
      "/api/v2/vault/recovery",
      "PUT",
      { masterWrapper: mocks.master, recoveryWrapper: mocks.recovery, recoveryKey: "must-not-cross-boundary" },
    ));
    expect(response.status).toBe(400);
    expect(mocks.replaceRecoveryWrappers).not.toHaveBeenCalled();
  });
});
