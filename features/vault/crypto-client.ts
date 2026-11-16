"use client";

import type { BackupEnvelope, BackupProtection, JsonObject, VaultPayload, VaultPayloadBase, VaultRecordEnvelope, VaultUnlockMaterial, WrappedVaultKeyEnvelope } from "@/lib/vault-crypto";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

export class VaultCryptoClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./crypto.worker.ts", import.meta.url), {
      type: "module",
      name: "keymint-vault-crypto",
    });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error ?? "Vault cryptography failed"));
    };
    worker.onerror = () => this.terminate(new Error("Vault cryptography worker failed"));
    this.worker = worker;
    return worker;
  }

  private request<T>(operation: string, payload?: unknown): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.getWorker().postMessage({ id, operation, payload });
    });
  }

  beginSetup(ownerId: string, vaultId: string, masterPassword: string) {
    return this.request<{ recoveryKey: string }>("beginSetup", {
      ownerId,
      vaultId,
      masterPassword,
    });
  }

  confirmSetup(recoveryKey: string) {
    return this.request<{
      masterWrapper: WrappedVaultKeyEnvelope;
      recoveryWrapper: WrappedVaultKeyEnvelope;
      records: VaultRecordEnvelope[];
    }>("confirmSetup", { recoveryKey });
  }

  unlock(material: VaultUnlockMaterial, masterPassword: string) {
    return this.request<{ unlocked: true }>("unlock", { material, masterPassword });
  }

  createMasterRewrap(masterPassword: string) {
    return this.request<WrappedVaultKeyEnvelope>("createMasterRewrap", { masterPassword });
  }

  adoptMasterRewrap(masterPassword: string, wrapper: WrappedVaultKeyEnvelope) {
    return this.request<{ adopted: true }>("adoptMasterRewrap", { masterPassword, wrapper });
  }

  beginRecovery(
    recoveryKey: string,
    newMasterPassword: string,
    masterWrapper: WrappedVaultKeyEnvelope,
    recoveryWrapper: WrappedVaultKeyEnvelope,
  ) {
    return this.request<{ recoveryKey: string }>("beginRecovery", {
      recoveryKey,
      newMasterPassword,
      masterWrapper,
      recoveryWrapper,
    });
  }

  confirmRecovery(recoveryKey: string) {
    return this.request<{
      masterWrapper: WrappedVaultKeyEnvelope;
      recoveryWrapper: WrappedVaultKeyEnvelope;
    }>("confirmRecovery", { recoveryKey });
  }

  beginKeyRotation(masterPassword: string) {
    return this.request<{ recoveryKey: string; targetKeyVersion: number }>("beginKeyRotation", { masterPassword });
  }

  confirmKeyRotation(recoveryKey: string) {
    return this.request<{
      masterWrapper: WrappedVaultKeyEnvelope;
      recoveryWrapper: WrappedVaultKeyEnvelope;
    }>("confirmKeyRotation", { recoveryKey });
  }

  rotateRecordEnvelopes(records: VaultRecordEnvelope[]) {
    return this.request<Array<{ expectedRevision: string; envelope: VaultRecordEnvelope }>>(
      "rotateRecordEnvelopes", records,
    );
  }

  adoptKeyRotation() {
    return this.request<{ adopted: true }>("adoptKeyRotation");
  }

  abortKeyRotation() {
    return this.request<{ aborted: true }>("abortKeyRotation");
  }

  decryptRecords(records: VaultRecordEnvelope[]) {
    return this.request<VaultPayload[]>("decryptRecords", records);
  }

  encryptRecord(payload: { current?: VaultPayloadBase; id?: string; type: VaultPayloadBase["type"]; value: JsonObject; now: string }) {
    return this.request<{ envelope: VaultRecordEnvelope; payload: VaultPayloadBase }>("encryptRecord", payload);
  }

  deleteRecord(current: VaultPayloadBase, now = new Date().toISOString()) {
    return this.request<VaultRecordEnvelope>("deleteRecord", { current, now });
  }

  upgradeRecordEnvelopes(records: VaultRecordEnvelope[]) {
    return this.request<Array<{ envelope: VaultRecordEnvelope; expectedRevision: string; payload: VaultPayload }>>(
      "upgradeRecordEnvelopes",
      records,
    );
  }

  exportBackup(records: VaultRecordEnvelope[], passphrase: string, now = new Date().toISOString()) {
    return this.request<BackupEnvelope>("exportBackup", { records, passphrase, now });
  }

  exportRecoveryBackup(
    records: VaultRecordEnvelope[],
    recoveryKey: string,
    recoveryWrapper: WrappedVaultKeyEnvelope,
    now = new Date().toISOString(),
  ) {
    return this.request<BackupEnvelope>("exportRecoveryBackup", {
      records, recoveryKey, recoveryWrapper, now,
    });
  }

  openBackup(envelope: BackupEnvelope, protection: BackupProtection) {
    return this.request<VaultPayload[]>("openBackup", { envelope, protection });
  }

  openRecoveryBackup(envelope: BackupEnvelope, recoveryKey: string) {
    return this.request<VaultPayload[]>("openRecoveryBackup", { envelope, recoveryKey });
  }

  lock(): void {
    if (!this.worker) return;
    this.worker.postMessage({ id: ++this.sequence, operation: "lock" });
    this.terminate(new Error("Vault locked"));
  }

  private terminate(reason: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }
}

export const vaultCryptoClient = new VaultCryptoClient();
