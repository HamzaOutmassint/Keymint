"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useVaultStore } from "@/features/vault/store";
import { vaultCryptoClient } from "@/features/vault/crypto-client";

export async function clearSensitiveClientState(queryClient: QueryClient) {
  vaultCryptoClient.lock();
  useVaultStore.getState().lock();
  useVaultStore.getState().setCreateOpen(false);
  await queryClient.cancelQueries().catch(() => undefined);
  queryClient.clear();
}
