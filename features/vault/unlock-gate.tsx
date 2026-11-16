"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, Button, FormField, Modal, api } from "@/components/ui";
import { canonicalizeJson, type WrappedVaultKeyEnvelope } from "@/lib/vault-crypto";
import { downloadLocalFile } from "./transfer";
import { vaultCryptoClient } from "./crypto-client";
import { useVaultStore } from "./store";
import { downloadVaultRecoveryMaterial, unlockVaultFromServer } from "./unlock-client";
import { VAULT_QUERY_KEY } from "./data";

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const unlocked = useVaultStore((state) => state.unlocked);
  const setUnlocked = useVaultStore((state) => state.setUnlocked);
  const [masterPassword, setMasterPassword] = useState("");
  const [mode, setMode] = useState<"unlock" | "recover" | "save">("unlock");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newMasterPassword, setNewMasterPassword] = useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [confirmedWrappers, setConfirmedWrappers] = useState<{
    masterWrapper: WrappedVaultKeyEnvelope;
    recoveryWrapper: WrappedVaultKeyEnvelope;
  } | null>(null);
  const recoveryFileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let lastActivity = performance.now();
    let hiddenAt: number | null = null;
    const lock = () => {
      queryClient.removeQueries({ queryKey: VAULT_QUERY_KEY });
      vaultCryptoClient.lock();
      useVaultStore.getState().lock();
    };
    const recordActivity = (event: Event) => {
      if (event.isTrusted && document.visibilityState === "visible") lastActivity = performance.now();
    };
    const checkTimeout = () => {
      if (!useVaultStore.getState().unlocked) return;
      const now = performance.now();
      if (now - lastActivity >= 15 * 60_000 || (hiddenAt !== null && now - hiddenAt >= 5 * 60_000)) {
        lock();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = performance.now();
      else {
        checkTimeout();
        hiddenAt = null;
      }
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) lock();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "keymint-vault-wrapper-change") lock();
    };
    window.addEventListener("pagehide", lock);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    for (const name of ["keydown", "pointerdown", "touchstart"] as const) {
      window.addEventListener(name, recordActivity);
    }
    const timer = window.setInterval(checkTimeout, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", lock);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
      for (const name of ["keydown", "pointerdown", "touchstart"] as const) {
        window.removeEventListener(name, recordActivity);
      }
    };
  }, [queryClient]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || masterPassword.length < 12) return;
    setBusy(true);
    try {
      await unlockVaultFromServer(masterPassword, vaultCryptoClient);
      setMasterPassword("");
      setUnlocked(true);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function resetRecovery() {
    setMode("unlock");
    setRecoveryKey("");
    setNewMasterPassword("");
    setConfirmMasterPassword("");
    setAccountPassword("");
    setNewRecoveryKey(null);
    setRecoveryConfirmation("");
    setConfirmedWrappers(null);
    if (recoveryFileRef.current) recoveryFileRef.current.value = "";
  }

  async function importRecoveryKey(file?: File) {
    if (!file) return;
    if (file.size > 1024) {
      toast.error("Recovery Key files must be smaller than 1 KB");
      return;
    }
    try {
      setRecoveryKey((await file.text()).trim());
    } catch {
      toast.error("The Recovery Key file could not be read");
    }
  }

  async function beginRecovery() {
    if (busy) return;
    if (newMasterPassword.length < 12) {
      toast.error("Use a new Master Password of at least 12 characters");
      return;
    }
    if (newMasterPassword !== confirmMasterPassword) {
      toast.error("New Master Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const material = await downloadVaultRecoveryMaterial();
      const result = await vaultCryptoClient.beginRecovery(
        recoveryKey,
        newMasterPassword,
        material.masterWrapper,
        material.recoveryWrapper,
      );
      setRecoveryKey("");
      setNewMasterPassword("");
      setConfirmMasterPassword("");
      setNewRecoveryKey(result.recoveryKey);
      setMode("save");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function completeRecovery() {
    if (!newRecoveryKey || busy) return;
    setBusy(true);
    try {
      const wrappers = confirmedWrappers ??
        await vaultCryptoClient.confirmRecovery(recoveryConfirmation);
      setConfirmedWrappers(wrappers);
      await api("/api/security/reauth", {
        method: "POST",
        body: JSON.stringify({ password: accountPassword }),
      });
      const stored = await api<{
        masterWrapper: WrappedVaultKeyEnvelope;
        recoveryWrapper: WrappedVaultKeyEnvelope;
      }>("/api/v2/vault/recovery", {
        method: "PUT",
        headers: { "Keymint-Vault-Protocol": "2" },
        body: JSON.stringify(wrappers),
      });
      if (
        canonicalizeJson(stored.masterWrapper) !== canonicalizeJson(wrappers.masterWrapper) ||
        canonicalizeJson(stored.recoveryWrapper) !== canonicalizeJson(wrappers.recoveryWrapper)
      ) throw new Error("Stored recovery wrappers did not match the local ceremony");
      localStorage.setItem("keymint-vault-wrapper-change", crypto.randomUUID());
      setUnlocked(true);
      resetRecovery();
      toast.success("Vault recovered with new Master and Recovery Keys");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {unlocked ? children : null}
      <Modal
        open={!unlocked}
        onClose={() => undefined}
        title={mode === "unlock" ? "Unlock your vault" : mode === "recover" ? "Recover your vault" : "Save your new Recovery Key"}
        description={mode === "unlock"
          ? "Your Master Password is processed only in this browser."
          : mode === "recover"
            ? "Your Recovery Key opens the vault locally, then both access wrappers are replaced."
            : "This key is shown once. Save it outside Keymint before continuing."}
        loading={busy}
        loadingLabel={mode === "unlock" ? "Deriving your local vault key" : "Verifying recovery locally"}
      >
        {mode === "unlock" && <form onSubmit={submit} className="flex flex-col gap-2 mt-4">
          <FormField label="Master Password" htmlFor="vault-unlock-password">
            <input
              id="vault-unlock-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={masterPassword}
              onChange={(event) => setMasterPassword(event.target.value)}
              data-autofocus
            />
          </FormField>
          <Button
            type="submit"
            variant="primary"
            className="btn-full"
            disabled={busy || masterPassword.length < 12}
            loading={busy}
            loadingLabel="Unlocking locally"
          >
            Unlock vault
          </Button>
          <Button type="button" variant="ghost" className="btn-full" onClick={() => setMode("recover")}>
            Use Recovery Key
          </Button>
        </form>}
        {mode === "recover" && (
          <div className="recovery-ceremony">
            <Alert variant="info">
              Account access and a valid Recovery Key are both required. Your old Recovery Key is retired after recovery.
            </Alert>
            <FormField
              label="Recovery Key"
              htmlFor="vault-recovery-key"
              description="Paste the KMV2-RK key or import the text file you saved."
            >
              <textarea
                id="vault-recovery-key"
                className="input recovery-key-input"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
                data-autofocus
              />
            </FormField>
            <input
              ref={recoveryFileRef}
              type="file"
              accept=".txt,.key,text/plain"
              hidden
              onChange={(event) => void importRecoveryKey(event.target.files?.[0])}
            />
            <Button type="button" onClick={() => recoveryFileRef.current?.click()}>
              Import Recovery Key file
            </Button>
            <FormField label="New Master Password" htmlFor="recovery-new-master">
              <input
                id="recovery-new-master"
                className="input"
                type="password"
                autoComplete="new-password"
                value={newMasterPassword}
                onChange={(event) => setNewMasterPassword(event.target.value)}
              />
            </FormField>
            <FormField label="Confirm new Master Password" htmlFor="recovery-confirm-master">
              <input
                id="recovery-confirm-master"
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmMasterPassword}
                onChange={(event) => setConfirmMasterPassword(event.target.value)}
              />
            </FormField>
            <div className="recovery-actions">
              <Button type="button" onClick={resetRecovery}>Back</Button>
              <Button
                type="button"
                variant="primary"
                onClick={beginRecovery}
                disabled={recoveryKey.length < 58 || newMasterPassword.length < 12}
              >
                Verify and recover
              </Button>
            </div>
          </div>
        )}
        {mode === "save" && newRecoveryKey && (
          <div className="recovery-ceremony">
            <Alert variant="danger">
              Keymint cannot show or restore this Recovery Key after you finish.
            </Alert>
            <div className="recovery-key-ticket" aria-label="New Recovery Key">
              <span>Keymint Vault Protocol V2</span>
              <code>{newRecoveryKey}</code>
            </div>
            <Button
              type="button"
              onClick={() => downloadLocalFile(
                `Keymint Vault Recovery Key\n\n${newRecoveryKey}\n\nKeep this file private and separate from your device.\n`,
                "text/plain;charset=utf-8",
                "keymint-recovery-key.txt",
              )}
            >
              Download Recovery Key
            </Button>
            <FormField
              label="Current Login Password"
              htmlFor="recovery-account-password"
              description="Required immediately before replacing the vault access wrappers."
            >
              <input
                id="recovery-account-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={accountPassword}
                onChange={(event) => setAccountPassword(event.target.value)}
              />
            </FormField>
            <FormField
              label="Confirm the complete Recovery Key"
              htmlFor="confirm-new-recovery-key"
              description="Re-enter the key from your saved copy. This verifies both its checksum and its ability to open the vault."
            >
              <textarea
                id="confirm-new-recovery-key"
                className="input recovery-key-input"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                value={recoveryConfirmation}
                onChange={(event) => setRecoveryConfirmation(event.target.value)}
              />
            </FormField>
            <Button
              type="button"
              variant="primary"
              className="btn-full"
              onClick={completeRecovery}
              disabled={recoveryConfirmation.length < 58 || accountPassword.length < 1}
            >
              Confirm and finish recovery
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
