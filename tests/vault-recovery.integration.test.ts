import { describe, expect, it } from "vitest";
import {
  createVaultUnlockMaterial,
  type VaultPayloadBase,
} from "@/lib/vault-crypto";
import { VaultCryptoRuntime } from "@/features/vault/crypto-runtime";

const OWNER_ID = "test_user";
const VAULT_ID = "58a3491e-a5b4-481b-9d67-5f691939655b";
const OLD_MASTER = "phase ten original master password";
const NEW_MASTER = "phase ten replacement master password";
const CREATED_AT = "2026-08-02T12:00:00.000Z";

describe("recovery architecture integration", () => {
  it("recovers with a one-time replacement key while credential ciphertext remains byte-for-byte unchanged", async () => {
    const setupRuntime = new VaultCryptoRuntime();
    const setup = await setupRuntime.beginSetup({
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      masterPassword: OLD_MASTER,
    });
    const originalWrappers = await setupRuntime.confirmSetup(setup.recoveryKey);
    const credential = await setupRuntime.encryptRecord({
      id: "4bcffcc8-78c6-4492-96bf-92a3df39b6e7",
      type: "credential",
      now: CREATED_AT,
      value: {
        categoryId: null,
        email: "ada@example.test",
        favorite: true,
        lastViewedAt: null,
        name: "Example",
        notes: "unchanged",
        password: "credential-secret",
        passwordUpdatedAt: CREATED_AT,
        username: "ada",
        website: "https://example.test",
      },
    });
    const originalCiphertext = structuredClone(credential.envelope);
    setupRuntime.lock();

    const recoveryRuntime = new VaultCryptoRuntime();
    const replacement = await recoveryRuntime.beginRecovery({
      recoveryKey: setup.recoveryKey,
      newMasterPassword: NEW_MASTER,
      masterWrapper: originalWrappers.masterWrapper,
      recoveryWrapper: originalWrappers.recoveryWrapper,
    });
    expect(replacement.recoveryKey).not.toBe(setup.recoveryKey);
    const replacementWrappers = await recoveryRuntime.confirmRecovery(
      replacement.recoveryKey,
    );

    expect(replacementWrappers.masterWrapper.protected.keyVersion).toBe(1);
    expect(replacementWrappers.recoveryWrapper.protected.keyVersion).toBe(1);
    expect(replacementWrappers.masterWrapper.protected.wrapRevision).toBe("2");
    expect(replacementWrappers.recoveryWrapper.protected.wrapRevision).toBe("2");
    expect(credential.envelope).toEqual(originalCiphertext);

    recoveryRuntime.lock();
    const unlocked = new VaultCryptoRuntime();
    await unlocked.unlock(
      createVaultUnlockMaterial(replacementWrappers.masterWrapper),
      NEW_MASTER,
    );
    const [opened] = await unlocked.decryptRecords([credential.envelope]);
    expect((opened as VaultPayloadBase).value.password).toBe("credential-secret");
    expect(credential.envelope).toEqual(originalCiphertext);
    unlocked.lock();
  }, 120_000);

  it("changes the Master Password by replacing only the master wrapper", async () => {
    const runtime = new VaultCryptoRuntime();
    const setup = await runtime.beginSetup({
      ownerId: OWNER_ID,
      vaultId: VAULT_ID,
      masterPassword: OLD_MASTER,
    });
    const wrappers = await runtime.confirmSetup(setup.recoveryKey);
    const record = await runtime.encryptRecord({
      id: "5bcffcc8-78c6-4492-96bf-92a3df39b6e7",
      type: "category",
      now: CREATED_AT,
      value: { color: "#235cdb", icon: "folder", name: "Work" },
    });
    const originalEnvelope = structuredClone(record.envelope);
    const replacementMaster = await runtime.createMasterRewrap(NEW_MASTER);
    await runtime.adoptMasterRewrap(NEW_MASTER, replacementMaster);

    expect(replacementMaster.protected.wrapRevision).toBe("2");
    expect(replacementMaster.protected.keyVersion).toBe(1);
    expect(wrappers.recoveryWrapper.protected.wrapRevision).toBe("1");
    expect(record.envelope).toEqual(originalEnvelope);
    await expect(runtime.decryptRecords([record.envelope])).resolves.toHaveLength(1);
    runtime.lock();
  }, 120_000);
});
