"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/components/ui";
import { vaultCryptoClient } from "./crypto-client";
import { useVaultStore } from "./store";
import type {
  CategoryPayloadV1,
  CategoryValueV1,
  CredentialPayloadV1,
  CredentialValueV1,
  JsonObject,
  VaultPayloadBase,
  VaultRecordEnvelope,
} from "@/lib/vault-crypto";
import type { Category, Credential } from "@/types/vault";
import { logClientActivity } from "@/features/activity/log-client";

export const VAULT_QUERY_KEY = ["decrypted-vault"] as const;

export type VaultSnapshot = {
  cursor: string;
  envelopes: VaultRecordEnvelope[];
  payloads: VaultPayloadBase[];
  categories: Category[];
  credentials: Credential[];
  payloadById: Map<string, VaultPayloadBase>;
};

type SyncResponse = { cursor: string; hasMore: boolean; records: VaultRecordEnvelope[]; protocolVersion: 2 };

function materialize(payloads: VaultPayloadBase[], envelopes: VaultRecordEnvelope[], cursor: string): VaultSnapshot {
  const categoryPayloads = payloads.filter((item): item is CategoryPayloadV1 => item.type === "category");
  const credentialPayloads = payloads.filter((item): item is CredentialPayloadV1 => item.type === "credential");
  const counts = new Map<string, number>();
  for (const item of credentialPayloads) {
    if (item.value.categoryId) counts.set(item.value.categoryId, (counts.get(item.value.categoryId) ?? 0) + 1);
  }
  const categories: Category[] = categoryPayloads.map((item) => ({
    id: item.id,
    name: item.value.name,
    color: item.value.color,
    icon: item.value.icon,
    pinned: item.value.pinned ?? false,
    updatedAt: item.updatedAt,
    _count: { credentials: counts.get(item.id) ?? 0 },
  }));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const credentials: Credential[] = credentialPayloads.map((item) => {
    const category = item.value.categoryId ? categoryById.get(item.value.categoryId) : undefined;
    return {
      id: item.id,
      name: item.value.name,
      username: item.value.username,
      email: item.value.email || null,
      website: item.value.website || null,
      password: item.value.password,
      notes: item.value.notes || null,
      categoryId: category?.id ?? null,
      favorite: item.value.favorite,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      passwordUpdatedAt: item.value.passwordUpdatedAt,
      lastViewed: item.value.lastViewedAt,
      category: category ? { id: category.id, name: category.name, color: category.color, icon: category.icon } : null,
    };
  });
  return { cursor, envelopes, payloads, categories, credentials, payloadById: new Map(payloads.map((item) => [item.id, item])) };
}

export async function loadVaultSnapshot(): Promise<VaultSnapshot> {
  let cursor = "0";
  let hasMore = true;
  const envelopeById = new Map<string, VaultRecordEnvelope>();
  while (hasMore) {
    const response = await api<SyncResponse>(`/api/v2/vault/sync?cursor=${encodeURIComponent(cursor)}`, {
      cache: "no-store",
      headers: { "Keymint-Vault-Protocol": "2" },
    });
    if (BigInt(response.cursor) < BigInt(cursor) || (response.hasMore && response.cursor === cursor)) {
      throw new Error("Vault synchronization did not make forward progress");
    }
    for (const record of response.records) envelopeById.set(record.protected.recordId, record);
    cursor = response.cursor;
    hasMore = response.hasMore;
  }
  let records = [...envelopeById.values()];
  let decrypted = await vaultCryptoClient.decryptRecords(records);
  const upgrades = await vaultCryptoClient.upgradeRecordEnvelopes(records);
  if (upgrades.length) {
    for (let index = 0; index < upgrades.length; index += 100) {
      await persistBatch(upgrades.slice(index, index + 100).map(({ envelope, expectedRevision }) => ({ envelope, expectedRevision })));
    }
    const upgradedEnvelopeById = new Map(upgrades.map((item) => [item.envelope.protected.recordId, item.envelope]));
    const payloadById = new Map(upgrades.map((item) => [item.payload.id, item.payload]));
    records = records.map((item) => upgradedEnvelopeById.get(item.protected.recordId) ?? item);
    decrypted = decrypted.map((item) => payloadById.get(item.id) ?? item);
  }
  const payloads = decrypted.filter((item): item is VaultPayloadBase => item.type !== "tombstone");
  return materialize(payloads, records, cursor);
}

export function useVaultData() {
  const unlocked = useVaultStore((state) => state.unlocked);
  return useQuery({ queryKey: VAULT_QUERY_KEY, queryFn: loadVaultSnapshot, enabled: unlocked });
}

async function persistBatch(records: Array<{ envelope: VaultRecordEnvelope; expectedRevision: string | null }>) {
  return api("/api/v2/vault/records/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Keymint-Vault-Protocol": "2" },
    body: JSON.stringify({
      mutationId: crypto.randomUUID(),
      records,
    }),
  });
}

async function persist(envelope: VaultRecordEnvelope, expectedRevision: string | null) {
  const mutationId = crypto.randomUUID();
  if (expectedRevision === null) {
    return api("/api/v2/vault/records", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Keymint-Vault-Protocol": "2" },
      body: JSON.stringify({ mutationId, envelope }),
    });
  }
  const recordId = encodeURIComponent(envelope.protected.recordId);
  return api(`/api/v2/vault/records/${recordId}`, {
    method: envelope.protected.state === "deleted" ? "DELETE" : "PUT",
    headers: { "Content-Type": "application/json", "Keymint-Vault-Protocol": "2" },
    body: JSON.stringify({ mutationId, expectedRevision, envelope }),
  });
}

export function useVaultMutations() {
  const queryClient = useQueryClient();
  const current = (id: string) => queryClient.getQueryData<VaultSnapshot>(VAULT_QUERY_KEY)?.payloadById.get(id);
  const refresh = () => queryClient.invalidateQueries({ queryKey: VAULT_QUERY_KEY });

  async function save(type: VaultPayloadBase["type"], value: JsonObject, id?: string) {
    const existing = id ? current(id) : undefined;
    const encrypted = await vaultCryptoClient.encryptRecord({ current: existing, type, value, now: new Date().toISOString() });
    await persist(encrypted.envelope, existing?.revision ?? null);
    if (type === "credential") {
      await logClientActivity(existing ? "PASSWORD_EDITED" : "PASSWORD_CREATED");
    } else if (type === "category" && !existing) {
      await logClientActivity("CATEGORY_CREATED");
    }
    await refresh();
    return encrypted.payload;
  }

  return {
    saveRecord: save,
    saveCredential: (value: CredentialValueV1, id?: string) => save("credential", value, id),
    saveCategory: (value: CategoryValueV1, id?: string) => save("category", value, id),
    remove: async (id: string) => {
      const existing = current(id);
      if (!existing) throw new Error("Encrypted vault record was not found");
      await persist(await vaultCryptoClient.deleteRecord(existing), existing.revision);
      if (existing.type === "credential") await logClientActivity("PASSWORD_DELETED");
      else if (existing.type === "category") await logClientActivity("CATEGORY_DELETED");
      await refresh();
    },
    touchCredential: async (credential: Credential) => {
      const existing = current(credential.id);
      if (!existing || existing.type !== "credential") return;
      const value = { ...(existing as CredentialPayloadV1).value, lastViewedAt: new Date().toISOString() };
      const encrypted = await vaultCryptoClient.encryptRecord({ current: existing, type: "credential", value, now: new Date().toISOString() });
      await persist(encrypted.envelope, existing.revision);
      await refresh();
    },
  };
}

export function searchVault(snapshot: VaultSnapshot, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { credentials: [], categories: [], recent: [] };
  const categories = snapshot.categories.filter((item) => item.name.toLocaleLowerCase().includes(needle)).slice(0, 10);
  const credentials = snapshot.credentials.filter((item) =>
    [item.name, item.username, item.email, item.website, item.notes, item.category?.name]
      .some((value) => value?.toLocaleLowerCase().includes(needle)),
  ).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 20);
  const recent = [...snapshot.credentials].filter((item) => item.lastViewed)
    .sort((a, b) => Date.parse(b.lastViewed ?? "") - Date.parse(a.lastViewed ?? "")).slice(0, 5);
  return { credentials, categories, recent };
}
