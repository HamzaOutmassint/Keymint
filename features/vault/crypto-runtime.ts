import {
  AuthenticationError,
  constantTimeEqual,
  createMasterVaultKeyWrapper,
  createRecoveryVaultKeyWrapper,
  decodeRecoveryKey,
  createVaultRecordProtectedHeader,
  decryptBackup,
  decryptVaultRecord,
  encryptBackup,
  encryptVaultRecord,
  generateRecoveryKey,
  generateVaultKey,
  openRecoveryVaultKeyWrapper,
  openMasterVaultKeyWrapper,
  secureErase,
  unlockVaultLocally,
  type VaultUnlockMaterial,
  type WrappedVaultKeyEnvelope,
  type VaultRecordEnvelope,
  type VaultPayload,
  type VaultPayloadBase,
  type BackupEnvelope,
  type BackupProtection,
  type JsonObject,
} from "@/lib/vault-crypto";

type PendingSetup = {
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
  recoverySecret: Uint8Array;
  records: VaultRecordEnvelope[];
};

type PendingRecovery = {
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
  recoverySecret: Uint8Array;
};

type PendingKeyRotation = {
  newVaultKey: Uint8Array;
  masterWrapper: WrappedVaultKeyEnvelope;
  recoveryWrapper: WrappedVaultKeyEnvelope;
  recoverySecret: Uint8Array;
  confirmed: boolean;
};

/** Owns raw Vault Key material inside the cryptographic worker lifecycle. */
export class VaultCryptoRuntime {
  private vaultKey: Uint8Array | null = null;
  private context: {
    ownerId: string;
    vaultId: string;
    keyVersion: number;
    masterWrapRevision: string;
    recoveryWrapRevision?: string;
  } | null = null;
  private pendingSetup: PendingSetup | null = null;
  private pendingRecovery: PendingRecovery | null = null;
  private pendingKeyRotation: PendingKeyRotation | null = null;

  async beginSetup(options: {
    ownerId: string;
    vaultId: string;
    masterPassword: string;
  }): Promise<{ recoveryKey: string }> {
    this.lock();
    const vaultKey = generateVaultKey();
    const recovery = await generateRecoveryKey();
    try {
      const [masterWrapper, recoveryWrapper] = await Promise.all([
        createMasterVaultKeyWrapper({
          vaultKey,
          masterPassword: options.masterPassword,
          ownerId: options.ownerId,
          vaultId: options.vaultId,
          keyVersion: 1,
          wrapRevision: "1",
        }),
        createRecoveryVaultKeyWrapper({
          vaultKey,
          recoverySecret: recovery.recoverySecret,
          ownerId: options.ownerId,
          vaultId: options.vaultId,
          keyVersion: 1,
          wrapRevision: "1",
        }),
      ]);
      this.vaultKey = vaultKey;
      this.context = {
        ownerId: options.ownerId,
        vaultId: options.vaultId,
        keyVersion: 1,
        masterWrapRevision: "1",
        recoveryWrapRevision: "1",
      };
      this.pendingSetup = {
        masterWrapper,
        recoveryWrapper,
        recoverySecret: recovery.recoverySecret,
        records: [],
      };
      return { recoveryKey: recovery.formatted };
    } catch (error) {
      secureErase(vaultKey, recovery.recoverySecret);
      throw error;
    }
  }

  async confirmSetup(recoveryKey: string): Promise<{
    masterWrapper: WrappedVaultKeyEnvelope;
    recoveryWrapper: WrappedVaultKeyEnvelope;
    records: VaultRecordEnvelope[];
  }> {
    if (!this.pendingSetup || !this.vaultKey) throw new Error("No vault setup is pending");
    let entered: Uint8Array | undefined;
    let opened: Uint8Array | undefined;
    try {
      entered = await decodeRecoveryKey(recoveryKey);
      opened = await openRecoveryVaultKeyWrapper(entered, this.pendingSetup.recoveryWrapper);
      if (!constantTimeEqual(opened, this.vaultKey)) throw new AuthenticationError();
      const result = {
        masterWrapper: this.pendingSetup.masterWrapper,
        recoveryWrapper: this.pendingSetup.recoveryWrapper,
        records: this.pendingSetup.records,
      };
      secureErase(this.pendingSetup.recoverySecret);
      this.pendingSetup = null;
      return result;
    } finally {
      secureErase(entered, opened);
    }
  }

  async unlock(material: VaultUnlockMaterial, masterPassword: string): Promise<void> {
    this.lock();
    this.vaultKey = await unlockVaultLocally(material, masterPassword);
    this.context = {
      ownerId: material.wrappedVaultKey.protected.ownerId as string,
      vaultId: material.wrappedVaultKey.protected.vaultId as string,
      keyVersion: material.wrappedVaultKey.protected.keyVersion as number,
      masterWrapRevision: material.wrappedVaultKey.protected.wrapRevision as string,
    };
  }

  /** Rewraps the active DEK under a new Master Password without touching record ciphertext. */
  async createMasterRewrap(masterPassword: string): Promise<WrappedVaultKeyEnvelope> {
    const { vaultKey, context } = this.requireUnlocked();
    return createMasterVaultKeyWrapper({
      vaultKey,
      masterPassword,
      ownerId: context.ownerId,
      vaultId: context.vaultId,
      keyVersion: context.keyVersion,
      wrapRevision: (BigInt(context.masterWrapRevision) + 1n).toString(),
    });
  }

  /** Authenticates the server-returned wrapper before adopting its revision locally. */
  async adoptMasterRewrap(
    masterPassword: string,
    wrapper: WrappedVaultKeyEnvelope,
  ): Promise<void> {
    const { vaultKey, context } = this.requireUnlocked();
    let opened: Uint8Array | undefined;
    try {
      if (
        wrapper.protected.ownerId !== context.ownerId ||
        wrapper.protected.vaultId !== context.vaultId ||
        wrapper.protected.keyVersion !== context.keyVersion ||
        wrapper.protected.purpose !== "master" ||
        wrapper.protected.wrapRevision !==
          (BigInt(context.masterWrapRevision) + 1n).toString()
      ) throw new AuthenticationError();
      opened = await openMasterVaultKeyWrapper(masterPassword, wrapper);
      if (!constantTimeEqual(opened, vaultKey)) throw new AuthenticationError();
      context.masterWrapRevision = wrapper.protected.wrapRevision;
    } finally {
      secureErase(opened);
    }
  }

  /** Opens the DEK with the old Recovery Key and prepares two replacement wrappers. */
  async beginRecovery(options: {
    recoveryKey: string;
    newMasterPassword: string;
    masterWrapper: WrappedVaultKeyEnvelope;
    recoveryWrapper: WrappedVaultKeyEnvelope;
  }): Promise<{ recoveryKey: string }> {
    this.lock();
    let oldRecoverySecret: Uint8Array | undefined;
    let vaultKey: Uint8Array | undefined;
    const nextRecovery = await generateRecoveryKey();
    try {
      oldRecoverySecret = await decodeRecoveryKey(options.recoveryKey);
      vaultKey = await openRecoveryVaultKeyWrapper(
        oldRecoverySecret,
        options.recoveryWrapper,
      );
      const header = options.recoveryWrapper.protected;
      if (
        options.masterWrapper.protected.ownerId !== header.ownerId ||
        options.masterWrapper.protected.vaultId !== header.vaultId ||
        options.masterWrapper.protected.keyVersion !== header.keyVersion ||
        options.masterWrapper.protected.purpose !== "master"
      ) throw new AuthenticationError();
      const nextRecoveryRevision = (BigInt(header.wrapRevision) + 1n).toString();
      const [masterWrapper, recoveryWrapper] = await Promise.all([
        createMasterVaultKeyWrapper({
          vaultKey,
          masterPassword: options.newMasterPassword,
          ownerId: header.ownerId,
          vaultId: header.vaultId,
          keyVersion: header.keyVersion,
          wrapRevision: (
            BigInt(options.masterWrapper.protected.wrapRevision) + 1n
          ).toString(),
        }),
        createRecoveryVaultKeyWrapper({
          vaultKey,
          recoverySecret: nextRecovery.recoverySecret,
          ownerId: header.ownerId,
          vaultId: header.vaultId,
          keyVersion: header.keyVersion,
          wrapRevision: nextRecoveryRevision,
        }),
      ]);
      this.vaultKey = vaultKey;
      vaultKey = undefined;
      this.context = {
        ownerId: header.ownerId,
        vaultId: header.vaultId,
        keyVersion: header.keyVersion,
        masterWrapRevision: masterWrapper.protected.wrapRevision,
        recoveryWrapRevision: recoveryWrapper.protected.wrapRevision,
      };
      this.pendingRecovery = {
        masterWrapper,
        recoveryWrapper,
        recoverySecret: nextRecovery.recoverySecret,
      };
      return { recoveryKey: nextRecovery.formatted };
    } catch (error) {
      secureErase(nextRecovery.recoverySecret);
      this.lock();
      throw error;
    } finally {
      secureErase(oldRecoverySecret, vaultKey);
    }
  }

  /** Verifies the newly displayed Recovery Key against its replacement wrapper. */
  async confirmRecovery(recoveryKey: string): Promise<{
    masterWrapper: WrappedVaultKeyEnvelope;
    recoveryWrapper: WrappedVaultKeyEnvelope;
  }> {
    if (!this.pendingRecovery || !this.vaultKey) {
      throw new Error("No vault recovery is pending");
    }
    let entered: Uint8Array | undefined;
    let opened: Uint8Array | undefined;
    try {
      entered = await decodeRecoveryKey(recoveryKey);
      opened = await openRecoveryVaultKeyWrapper(
        entered,
        this.pendingRecovery.recoveryWrapper,
      );
      if (!constantTimeEqual(opened, this.vaultKey)) throw new AuthenticationError();
      const result = {
        masterWrapper: this.pendingRecovery.masterWrapper,
        recoveryWrapper: this.pendingRecovery.recoveryWrapper,
      };
      secureErase(this.pendingRecovery.recoverySecret);
      this.pendingRecovery = null;
      return result;
    } finally {
      secureErase(entered, opened);
    }
  }

  /** Creates a fresh Vault Key and two version-bound wrappers inside the worker. */
  async beginKeyRotation(masterPassword: string): Promise<{ recoveryKey: string; targetKeyVersion: number }> {
    const { context } = this.requireUnlocked();
    this.abortKeyRotation();
    const newVaultKey = generateVaultKey();
    const recovery = await generateRecoveryKey();
    const targetKeyVersion = context.keyVersion + 1;
    try {
      const [masterWrapper, recoveryWrapper] = await Promise.all([
        createMasterVaultKeyWrapper({
          vaultKey: newVaultKey,
          masterPassword,
          ownerId: context.ownerId,
          vaultId: context.vaultId,
          keyVersion: targetKeyVersion,
          wrapRevision: "1",
        }),
        createRecoveryVaultKeyWrapper({
          vaultKey: newVaultKey,
          recoverySecret: recovery.recoverySecret,
          ownerId: context.ownerId,
          vaultId: context.vaultId,
          keyVersion: targetKeyVersion,
          wrapRevision: "1",
        }),
      ]);
      this.pendingKeyRotation = {
        newVaultKey, masterWrapper, recoveryWrapper,
        recoverySecret: recovery.recoverySecret, confirmed: false,
      };
      return { recoveryKey: recovery.formatted, targetKeyVersion };
    } catch (error) {
      secureErase(newVaultKey, recovery.recoverySecret);
      throw error;
    }
  }

  /** Verifies the one-time Recovery Key before any rotated ciphertext is staged. */
  async confirmKeyRotation(recoveryKey: string): Promise<{
    masterWrapper: WrappedVaultKeyEnvelope;
    recoveryWrapper: WrappedVaultKeyEnvelope;
  }> {
    const pending = this.pendingKeyRotation;
    if (!pending) throw new Error("No Vault Key rotation is pending");
    let entered: Uint8Array | undefined;
    let opened: Uint8Array | undefined;
    try {
      entered = await decodeRecoveryKey(recoveryKey);
      opened = await openRecoveryVaultKeyWrapper(entered, pending.recoveryWrapper);
      if (!constantTimeEqual(opened, pending.newVaultKey)) throw new AuthenticationError();
      pending.confirmed = true;
      return { masterWrapper: pending.masterWrapper, recoveryWrapper: pending.recoveryWrapper };
    } finally {
      secureErase(entered, opened);
    }
  }

  /** Re-encrypts a resumable batch under the pending key without exposing either key. */
  async rotateRecordEnvelopes(records: VaultRecordEnvelope[]): Promise<Array<{
    expectedRevision: string;
    envelope: VaultRecordEnvelope;
  }>> {
    const { vaultKey, context } = this.requireUnlocked();
    const pending = this.pendingKeyRotation;
    if (!pending?.confirmed) throw new Error("Confirm the new Recovery Key before rotating records");
    const result = [];
    for (const record of records) {
      if (
        record.protected.ownerId !== context.ownerId ||
        record.protected.vaultId !== context.vaultId ||
        record.protected.keyVersion !== context.keyVersion
      ) throw new TypeError("Encrypted record belongs to a different vault");
      const original = await decryptVaultRecord(vaultKey, record);
      const revision = (BigInt(original.revision) + 1n).toString();
      const payload = { ...original, revision } as VaultPayload;
      const envelope = await encryptVaultRecord({
        vaultKey: pending.newVaultKey,
        protected: createVaultRecordProtectedHeader({
          ownerId: context.ownerId,
          vaultId: context.vaultId,
          recordId: original.id,
          keyVersion: context.keyVersion + 1,
          revision,
          state: original.type === "tombstone" ? "deleted" : "active",
          recordType: original.type,
        }),
        payload,
      });
      result.push({ expectedRevision: original.revision, envelope });
    }
    return result;
  }

  /** Adopts the fresh key only after the server's atomic cutover succeeds. */
  adoptKeyRotation(): void {
    const { context } = this.requireUnlocked();
    const pending = this.pendingKeyRotation;
    if (!pending?.confirmed) throw new Error("No confirmed Vault Key rotation is pending");
    secureErase(this.vaultKey, pending.recoverySecret);
    this.vaultKey = pending.newVaultKey;
    context.keyVersion += 1;
    context.masterWrapRevision = "1";
    context.recoveryWrapRevision = "1";
    this.pendingKeyRotation = null;
  }

  abortKeyRotation(): void {
    secureErase(this.pendingKeyRotation?.newVaultKey, this.pendingKeyRotation?.recoverySecret);
    this.pendingKeyRotation = null;
  }

  private requireUnlocked() {
    if (!this.vaultKey || !this.context) throw new Error("Vault is locked");
    return { vaultKey: this.vaultKey, context: this.context };
  }

  /** Decrypts opaque sync records only after validating their routing bindings. */
  async decryptRecords(records: VaultRecordEnvelope[]): Promise<VaultPayload[]> {
    const { vaultKey, context } = this.requireUnlocked();
    const payloads: VaultPayload[] = [];
    for (const record of records) {
      if (
        record.protected.ownerId !== context.ownerId ||
        record.protected.vaultId !== context.vaultId ||
        record.protected.keyVersion !== context.keyVersion
      ) throw new TypeError("Encrypted record belongs to a different vault");
      payloads.push(await decryptVaultRecord(vaultKey, record));
    }
    return payloads;
  }

  /** Creates or replaces one complete encrypted payload with a monotonic revision. */
  async encryptRecord(options: {
    current?: VaultPayloadBase;
    id?: string;
    type: VaultPayloadBase["type"];
    value: JsonObject;
    now: string;
  }): Promise<{ envelope: VaultRecordEnvelope; payload: VaultPayloadBase }> {
    const { vaultKey, context } = this.requireUnlocked();
    const id = options.current?.id ?? options.id ?? crypto.randomUUID();
    const revision = options.current ? (BigInt(options.current.revision) + 1n).toString() : "1";
    const payload = {
      createdAt: options.current?.createdAt ?? options.now,
      id,
      payloadVersion: 1 as const,
      revision,
      type: options.type,
      updatedAt: options.now,
      value: options.value,
    } as VaultPayloadBase;
    const envelope = await encryptVaultRecord({
      vaultKey,
      protected: createVaultRecordProtectedHeader({ ...context, recordId: id, revision, state: "active", recordType: options.type }),
      payload: payload as VaultPayload,
    });
    return { envelope, payload };
  }

  async deleteRecord(current: VaultPayloadBase, now: string): Promise<VaultRecordEnvelope> {
    const { vaultKey, context } = this.requireUnlocked();
    const revision = (BigInt(current.revision) + 1n).toString();
    return encryptVaultRecord({
      vaultKey,
      protected: createVaultRecordProtectedHeader({ ...context, recordId: current.id, revision, state: "deleted", recordType: "tombstone" }),
      payload: { deletedAt: now, id: current.id, payloadVersion: 1, revision, type: "tombstone" },
    });
  }

  /** Authenticates envelopeVersion 1 records, then emits canonical version 2 envelopes. */
  async upgradeRecordEnvelopes(records: VaultRecordEnvelope[]): Promise<Array<{
    envelope: VaultRecordEnvelope;
    expectedRevision: string;
    payload: VaultPayload;
  }>> {
    const { vaultKey, context } = this.requireUnlocked();
    const upgraded = [];
    for (const record of records) {
      if (record.protected.envelopeVersion !== 1) continue;
      if (
        record.protected.ownerId !== context.ownerId ||
        record.protected.vaultId !== context.vaultId ||
        record.protected.keyVersion !== context.keyVersion
      ) throw new TypeError("Legacy encrypted record belongs to a different vault");
      const original = await decryptVaultRecord(vaultKey, record);
      const revision = (BigInt(original.revision) + 1n).toString();
      const payload = { ...original, revision } as VaultPayload;
      const envelope = await encryptVaultRecord({
        vaultKey,
        protected: createVaultRecordProtectedHeader({
          ...context,
          recordId: original.id,
          revision,
          state: original.type === "tombstone" ? "deleted" : "active",
          recordType: original.type,
        }),
        payload,
      });
      upgraded.push({ envelope, expectedRevision: original.revision, payload });
    }
    return upgraded;
  }

  async exportBackup(records: VaultRecordEnvelope[], passphrase: string, now: string): Promise<BackupEnvelope> {
    const { vaultKey, context } = this.requireUnlocked();
    return encryptBackup({
      backupId: crypto.randomUUID(), createdAt: now, exportedAt: now,
      source: {
        ownerId: context.ownerId,
        vaultId: context.vaultId,
        keyVersion: context.keyVersion,
      },
      records: records.filter((record) => record.protected.state === "active"),
      vaultKey, protection: { type: "passphrase", passphrase },
    });
  }

  /** Verifies the account Recovery Key, then protects a local backup with it. */
  async exportRecoveryBackup(
    records: VaultRecordEnvelope[],
    recoveryKey: string,
    recoveryWrapper: WrappedVaultKeyEnvelope,
    now: string,
  ): Promise<BackupEnvelope> {
    const { vaultKey, context } = this.requireUnlocked();
    let recoverySecret: Uint8Array | undefined;
    let opened: Uint8Array | undefined;
    try {
      if (
        recoveryWrapper.protected.ownerId !== context.ownerId ||
        recoveryWrapper.protected.vaultId !== context.vaultId ||
        recoveryWrapper.protected.keyVersion !== context.keyVersion ||
        recoveryWrapper.protected.purpose !== "recovery"
      ) throw new AuthenticationError();
      recoverySecret = await decodeRecoveryKey(recoveryKey);
      opened = await openRecoveryVaultKeyWrapper(recoverySecret, recoveryWrapper);
      if (!constantTimeEqual(opened, vaultKey)) throw new AuthenticationError();
      return await encryptBackup({
        backupId: crypto.randomUUID(),
        createdAt: now,
        exportedAt: now,
        source: {
          ownerId: context.ownerId,
          vaultId: context.vaultId,
          keyVersion: context.keyVersion,
        },
        records: records.filter((record) => record.protected.state === "active"),
        vaultKey,
        protection: { type: "recovery-key", recoverySecret },
      });
    } finally {
      secureErase(recoverySecret, opened);
    }
  }

  /** Opens a Recovery Key-protected backup without exposing decoded key bytes. */
  async openRecoveryBackup(envelope: BackupEnvelope, recoveryKey: string) {
    let recoverySecret: Uint8Array | undefined;
    try {
      recoverySecret = await decodeRecoveryKey(recoveryKey);
      return await this.openBackup(envelope, {
        type: "recovery-key",
        recoverySecret,
      });
    } finally {
      secureErase(recoverySecret);
    }
  }

  async openBackup(envelope: BackupEnvelope, protection: BackupProtection) {
    const opened = await decryptBackup(envelope, protection);
    try {
      return opened.records;
    } finally {
      secureErase(opened.vaultKey);
    }
  }

  isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  lock(): void {
    secureErase(
      this.vaultKey,
      this.pendingSetup?.recoverySecret,
      this.pendingRecovery?.recoverySecret,
      this.pendingKeyRotation?.newVaultKey,
      this.pendingKeyRotation?.recoverySecret,
    );
    this.vaultKey = null;
    this.context = null;
    this.pendingSetup = null;
    this.pendingRecovery = null;
    this.pendingKeyRotation = null;
  }
}
