import { beforeAll, describe, expect, it } from "vitest";
import {
  createMasterVaultKeyWrapper,
  createVaultUnlockMaterial,
  generateVaultKey,
  secureErase,
  type VaultUnlockMaterial,
} from "@/lib/vault-crypto";
import { VaultCryptoRuntime } from "@/features/vault/crypto-runtime";
import { unlockVaultFromServer } from "@/features/vault/unlock-client";

const MASTER_PASSWORD = "Correct Horse Battery Staple!";
let material: VaultUnlockMaterial;

beforeAll(async () => {
  const vaultKey = generateVaultKey();
  try {
    material = createVaultUnlockMaterial(
      await createMasterVaultKeyWrapper({
        vaultKey,
        masterPassword: MASTER_PASSWORD,
        ownerId: "user_test",
        vaultId: "7d920c05-1477-4ec8-b6f5-797aaab0e110",
        keyVersion: 1,
        wrapRevision: "1",
      }),
    );
  } finally {
    secureErase(vaultKey);
  }
}, 30_000);

function bootstrapFetch(requests: Array<{ input: string; init?: RequestInit }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return Response.json({ data: material }, { status: 200 });
  }) as typeof fetch;
}

describe("local vault unlock integration", () => {
  it("never includes the Master Password in an unlock request payload", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const runtime = new VaultCryptoRuntime();

    await unlockVaultFromServer(MASTER_PASSWORD, runtime, bootstrapFetch(requests));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: "/api/v2/vault/bootstrap",
      init: { method: "GET", cache: "no-store" },
    });
    expect(requests[0].init?.body).toBeUndefined();
    expect(JSON.stringify(requests[0])).not.toContain(MASTER_PASSWORD);
    runtime.lock();
  }, 30_000);

  it("rejects an incorrect Master Password locally", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const runtime = new VaultCryptoRuntime();

    await expect(
      unlockVaultFromServer("Incorrect Master Password!", runtime, bootstrapFetch(requests)),
    ).rejects.toThrow("incorrect or the authenticated data is damaged");
    expect(runtime.isUnlocked()).toBe(false);
    expect(requests).toHaveLength(1);
  }, 30_000);

  it("unlocks with the correct Master Password entirely locally", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const runtime = new VaultCryptoRuntime();

    await unlockVaultFromServer(MASTER_PASSWORD, runtime, bootstrapFetch(requests));

    expect(runtime.isUnlocked()).toBe(true);
    expect(requests).toHaveLength(1);
    runtime.lock();
  }, 30_000);
});
