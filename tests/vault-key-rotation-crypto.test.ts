import { describe, expect, it } from "vitest";
import { VaultCryptoRuntime } from "@/features/vault/crypto-runtime";

describe("Vault Key rotation worker protocol", () => {
  it("re-encrypts records under a fresh key and adopts it only after confirmation", async () => {
    const runtime = new VaultCryptoRuntime();
    const setup = await runtime.beginSetup({
      ownerId: "user-1",
      vaultId: "5a0fdb76-2ec2-4e0d-b6ac-30d339325c92",
      masterPassword: "old-master-password",
    });
    await runtime.confirmSetup(setup.recoveryKey);
    const original = await runtime.encryptRecord({
      id: "record-1",
      type: "credential",
      now: "2026-08-04T18:00:00.000Z",
      value: {
        categoryId: null, email: "", favorite: false, lastViewedAt: null,
        name: "Example", notes: "", password: "secret",
        passwordUpdatedAt: "2026-08-04T18:00:00.000Z", username: "alice", website: "",
      },
    });

    const pending = await runtime.beginKeyRotation("new-master-password");
    expect(pending.targetKeyVersion).toBe(2);
    await expect(runtime.confirmKeyRotation(setup.recoveryKey)).rejects.toThrow();
    await runtime.confirmKeyRotation(pending.recoveryKey);

    const [rotated] = await runtime.rotateRecordEnvelopes([original.envelope]);
    expect(rotated.expectedRevision).toBe("1");
    expect(rotated.envelope.protected).toMatchObject({ keyVersion: 2, revision: "2" });
    expect(rotated.envelope.ciphertext).not.toBe(original.envelope.ciphertext);

    runtime.adoptKeyRotation();
    await expect(runtime.decryptRecords([rotated.envelope])).resolves.toMatchObject([
      { id: "record-1", revision: "2", value: { password: "secret" } },
    ]);
    await expect(runtime.decryptRecords([original.envelope])).rejects.toThrow(/different vault/);
    runtime.lock();
  }, 30_000);
});
