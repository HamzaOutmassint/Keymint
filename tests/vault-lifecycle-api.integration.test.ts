import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const vaultId = "ac635e41-e0f1-4af8-afb6-bfc46109c1d0";
  const master = { protected: { vaultId, ownerId: "user-1", purpose: "master", keyVersion: 1, wrapRevision: "1" }, nonce: "master-nonce", ciphertext: "master-ciphertext" };
  const recovery = { protected: { vaultId, ownerId: "user-1", purpose: "recovery", keyVersion: 1, wrapRevision: "1" }, nonce: "recovery-nonce", ciphertext: "recovery-ciphertext" };
  return { TestApiError, vaultId, master, recovery };
});

vi.mock("@/server/http", () => ({
  ApiError: mocks.TestApiError,
  assertSameOrigin: (request: Request) => {
    if (request.headers.get("origin") !== "http://localhost") throw new mocks.TestApiError(403, "Invalid request origin");
  },
  assertVaultProtocolV2: (request: Request) => {
    if (request.headers.get("Keymint-Vault-Protocol") !== "2") throw new mocks.TestApiError(426, "Vault Protocol 2 is required");
  },
  requireSession: async () => ({ user: { id: "user-1" } }),
  parseJson: async (request: Request, schema: { parse(value: unknown): unknown }) => schema.parse(await request.json()),
  ok: (data: unknown, init: ResponseInit = {}) => Response.json({ data }, { ...init, headers: { "cache-control": "no-store" } }),
  handleApiError: (error: unknown) => {
    if (error instanceof mocks.TestApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Validation failed" }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "unexpected" }, { status: 500 });
  },
}));

vi.mock("@/lib/prisma", () => {
  const operations = {
    vault: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    vaultKeyEnvelope: { createMany: vi.fn(async () => ({})) },
  };
  return {
    prisma: {
      ...operations,
      $transaction: vi.fn(async (input: unknown) => Array.isArray(input) ? Promise.all(input) : input),
    },
  };
});

vi.mock("@/server/v2-vault", () => ({
  getVaultUnlockMaterial: vi.fn(async () => ({
    protocolVersion: 2,
    wrappedVaultKey: { protected: mocks.master.protected, nonce: mocks.master.nonce, ciphertext: mocks.master.ciphertext },
    kdf: { name: "argon2id" }, salt: "opaque-salt",
  })),
  validateSubmittedWrapper: vi.fn((value: unknown, _owner: string, purpose: string) => purpose === "master" ? mocks.master : mocks.recovery),
  wrapperCreateData: vi.fn((value: unknown) => value),
}));

import { GET as BOOTSTRAP } from "@/app/api/v2/vault/bootstrap/route";
import { POST as SETUP } from "@/app/api/v2/vault/setup/route";

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { origin: "http://localhost", "Keymint-Vault-Protocol": "2", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("ciphertext vault lifecycle endpoint integration", () => {
  it("returns only opaque local-unlock material from bootstrap", async () => {
    const response = await BOOTSTRAP(request("/api/v2/vault/bootstrap"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("master-ciphertext");
    expect(text).not.toMatch(/masterPassword|passwordHash/);
  });

  it("sets up a vault from browser-created wrappers", async () => {
    const response = await SETUP(request("/api/v2/vault/setup", "POST", {
      masterWrapper: mocks.master, recoveryWrapper: mocks.recovery,
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { configured: true, protocolVersion: 2 } });
  });
});
