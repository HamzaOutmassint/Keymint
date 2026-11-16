/// <reference lib="webworker" />

import { VaultCryptoRuntime } from "./crypto-runtime";

type WorkerRequest =
  | { id: number; operation: "beginSetup"; payload: { ownerId: string; vaultId: string; masterPassword: string } }
  | { id: number; operation: "confirmSetup"; payload: { recoveryKey: string } }
  | { id: number; operation: "unlock"; payload: { material: Parameters<VaultCryptoRuntime["unlock"]>[0]; masterPassword: string } }
  | { id: number; operation: "createMasterRewrap"; payload: { masterPassword: string } }
  | { id: number; operation: "adoptMasterRewrap"; payload: { masterPassword: string; wrapper: Parameters<VaultCryptoRuntime["adoptMasterRewrap"]>[1] } }
  | { id: number; operation: "beginRecovery"; payload: Parameters<VaultCryptoRuntime["beginRecovery"]>[0] }
  | { id: number; operation: "confirmRecovery"; payload: { recoveryKey: string } }
  | { id: number; operation: "beginKeyRotation"; payload: { masterPassword: string } }
  | { id: number; operation: "confirmKeyRotation"; payload: { recoveryKey: string } }
  | { id: number; operation: "rotateRecordEnvelopes"; payload: Parameters<VaultCryptoRuntime["rotateRecordEnvelopes"]>[0] }
  | { id: number; operation: "adoptKeyRotation"; payload?: undefined }
  | { id: number; operation: "abortKeyRotation"; payload?: undefined }
  | { id: number; operation: "decryptRecords"; payload: Parameters<VaultCryptoRuntime["decryptRecords"]>[0] }
  | { id: number; operation: "encryptRecord"; payload: Parameters<VaultCryptoRuntime["encryptRecord"]>[0] }
  | { id: number; operation: "deleteRecord"; payload: { current: Parameters<VaultCryptoRuntime["deleteRecord"]>[0]; now: string } }
  | { id: number; operation: "upgradeRecordEnvelopes"; payload: Parameters<VaultCryptoRuntime["upgradeRecordEnvelopes"]>[0] }
  | { id: number; operation: "exportBackup"; payload: { records: Parameters<VaultCryptoRuntime["exportBackup"]>[0]; passphrase: string; now: string } }
  | { id: number; operation: "exportRecoveryBackup"; payload: { records: Parameters<VaultCryptoRuntime["exportRecoveryBackup"]>[0]; recoveryKey: string; recoveryWrapper: Parameters<VaultCryptoRuntime["exportRecoveryBackup"]>[2]; now: string } }
  | { id: number; operation: "openBackup"; payload: { envelope: Parameters<VaultCryptoRuntime["openBackup"]>[0]; protection: Parameters<VaultCryptoRuntime["openBackup"]>[1] } }
  | { id: number; operation: "openRecoveryBackup"; payload: { envelope: Parameters<VaultCryptoRuntime["openRecoveryBackup"]>[0]; recoveryKey: string } }
  | { id: number; operation: "lock"; payload?: undefined };

const runtime = new VaultCryptoRuntime();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.operation === "beginSetup") result = await runtime.beginSetup(request.payload);
    else if (request.operation === "confirmSetup") result = await runtime.confirmSetup(request.payload.recoveryKey);
    else if (request.operation === "unlock") {
      await runtime.unlock(request.payload.material, request.payload.masterPassword);
      result = { unlocked: true };
    } else if (request.operation === "createMasterRewrap") result = await runtime.createMasterRewrap(request.payload.masterPassword);
    else if (request.operation === "adoptMasterRewrap") {
      await runtime.adoptMasterRewrap(request.payload.masterPassword, request.payload.wrapper);
      result = { adopted: true };
    }
    else if (request.operation === "beginRecovery") result = await runtime.beginRecovery(request.payload);
    else if (request.operation === "confirmRecovery") result = await runtime.confirmRecovery(request.payload.recoveryKey);
    else if (request.operation === "beginKeyRotation") result = await runtime.beginKeyRotation(request.payload.masterPassword);
    else if (request.operation === "confirmKeyRotation") result = await runtime.confirmKeyRotation(request.payload.recoveryKey);
    else if (request.operation === "rotateRecordEnvelopes") result = await runtime.rotateRecordEnvelopes(request.payload);
    else if (request.operation === "adoptKeyRotation") {
      runtime.adoptKeyRotation();
      result = { adopted: true };
    }
    else if (request.operation === "abortKeyRotation") {
      runtime.abortKeyRotation();
      result = { aborted: true };
    }
    else if (request.operation === "decryptRecords") result = await runtime.decryptRecords(request.payload);
    else if (request.operation === "encryptRecord") result = await runtime.encryptRecord(request.payload);
    else if (request.operation === "deleteRecord") result = await runtime.deleteRecord(request.payload.current, request.payload.now);
    else if (request.operation === "upgradeRecordEnvelopes") result = await runtime.upgradeRecordEnvelopes(request.payload);
    else if (request.operation === "exportBackup") result = await runtime.exportBackup(request.payload.records, request.payload.passphrase, request.payload.now);
    else if (request.operation === "exportRecoveryBackup") result = await runtime.exportRecoveryBackup(request.payload.records, request.payload.recoveryKey, request.payload.recoveryWrapper, request.payload.now);
    else if (request.operation === "openBackup") result = await runtime.openBackup(request.payload.envelope, request.payload.protection);
    else if (request.operation === "openRecoveryBackup") result = await runtime.openRecoveryBackup(request.payload.envelope, request.payload.recoveryKey);
    else {
      runtime.lock();
      result = { locked: true };
    }
    scope.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error:
        error instanceof Error && error.name !== "AuthenticationError"
          ? error.message
          : "Master Password or key is incorrect, or the data is damaged",
    });
  }
};
