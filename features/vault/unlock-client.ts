"use client";

import {
  envelopeFromVaultUnlockMaterial,
  type VaultUnlockMaterial,
  type WrappedVaultKeyEnvelope,
} from "@/lib/vault-crypto";

export type UnlockWorker = {
  unlock(material: VaultUnlockMaterial, masterPassword: string): Promise<unknown>;
};

/** Downloads only public wrapper material; the Master Password is never a fetch input. */
export async function downloadVaultUnlockMaterial(
  fetcher: typeof fetch = fetch,
): Promise<VaultUnlockMaterial> {
  const response = await fetcher("/api/v2/vault/bootstrap", {
    method: "GET",
    headers: { "Keymint-Vault-Protocol": "2" },
    cache: "no-store",
  });
  const payload = (await response.json()) as { data?: VaultUnlockMaterial; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error ?? "Unable to load vault wrapper");
  envelopeFromVaultUnlockMaterial(payload.data);
  return payload.data;
}

/** Coordinates a password-free network read with local worker verification. */
export async function unlockVaultFromServer(
  masterPassword: string,
  worker: UnlockWorker,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const material = await downloadVaultUnlockMaterial(fetcher);
  await worker.unlock(material, masterPassword);
}

export type VaultRecoveryMaterial = {
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
};

/** Downloads only opaque wrappers; Recovery Keys are never fetch inputs. */
export async function downloadVaultRecoveryMaterial(
  fetcher: typeof fetch = fetch,
): Promise<VaultRecoveryMaterial> {
  const response = await fetcher("/api/v2/vault/recovery", {
    method: "GET",
    headers: { "Keymint-Vault-Protocol": "2" },
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    data?: VaultRecoveryMaterial;
    error?: string;
  };
  if (!response.ok || !payload.data) {
    throw new Error(payload.error ?? "Unable to load recovery wrapper");
  }
  return payload.data;
}
