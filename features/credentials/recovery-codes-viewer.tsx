"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Alert, Button, IconButton, Modal } from "@/components/ui";
import { copySensitiveText } from "@/features/security/clipboard";
import { logClientActivity } from "@/features/activity/log-client";
import { useVaultMutations } from "@/features/vault/data";
import { downloadLocalFile } from "@/features/vault/transfer";
import {
  buildRecoveryCodeSet,
  formatRecoveryCodesTxt,
  isRecoveryCodeSetLow,
  recoveryCodesFilename,
  remainingRecoveryCodes,
  setRecoveryCodeUsed,
  withRecoveryCodes,
} from "@/lib/recovery-codes";
import type { Credential } from "@/types/vault";
import { RecoveryCodesImporter } from "./recovery-codes-importer";

function formatUsedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

/** Lists a credential's recovery codes after the caller has verified the action. */
export function RecoveryCodesViewer({
  credential,
  open,
  onClose,
}: {
  credential: Credential;
  open: boolean;
  onClose: () => void;
}) {
  const mutations = useVaultMutations();
  const [mode, setMode] = useState<"list" | "replace" | "remove">("list");
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const set = credential.recoveryCodes ?? null;
  const remaining = remainingRecoveryCodes(set);

  function close() {
    setMode("list");
    onClose();
  }

  async function markUsed(code: string, used: boolean) {
    setSavingCode(code);
    try {
      await mutations.updateCredential(credential.id, (value) => {
        if (!value.recoveryCodes) return value;
        const now = new Date().toISOString();
        return withRecoveryCodes(value, setRecoveryCodeUsed(value.recoveryCodes, code, used ? now : null, now));
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingCode(null);
    }
  }

  async function copy(code: string, used: boolean) {
    setCopying(code);
    try {
      await copySensitiveText(code);
      await logClientActivity("RECOVERY_CODE_COPIED");
      toast.success("Recovery code copied; Keymint will try to clear it in 30 seconds", used ? undefined : {
        action: { label: "Mark as used", onClick: () => void markUsed(code, true) },
      });
    } catch {
      toast.error("Recovery code could not be copied");
    } finally {
      setCopying(null);
    }
  }

  async function replace(codes: string[]) {
    setSaving(true);
    try {
      await mutations.updateCredential(credential.id, (value) =>
        withRecoveryCodes(value, buildRecoveryCodeSet(codes, value.recoveryCodes, new Date().toISOString())));
      toast.success("Recovery codes saved");
      setMode("list");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAll() {
    setSaving(true);
    try {
      await mutations.updateCredential(credential.id, (value) => withRecoveryCodes(value, null));
      toast.success("Recovery codes removed");
      close();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function download() {
    if (!set) return;
    downloadLocalFile(formatRecoveryCodesTxt(credential.name, set), "text/plain;charset=utf-8", recoveryCodesFilename(credential.name));
    toast.success("Unused recovery codes downloaded");
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === "replace" ? "Replace recovery codes" : mode === "remove" ? "Remove recovery codes?" : `${credential.name} recovery codes`}
      description={mode === "list" ? "Each code works once. Mark a code as used after you sign in with it." : undefined}
      loading={saving}
      loadingLabel="Saving encrypted recovery codes"
      footer={
        mode === "list" ? (
          <>
            {set && (
              <Button icon={<Icon icon={Download01Icon} size={16} />} onClick={download} disabled={remaining === 0}>
                Download unused
              </Button>
            )}
            <Button onClick={() => setMode("replace")}>{set ? "Replace codes" : "Add codes"}</Button>
            <Button variant="primary" onClick={close}>Done</Button>
          </>
        ) : mode === "remove" ? (
          <>
            <Button onClick={() => setMode("list")}>Cancel</Button>
            <Button variant="danger" onClick={() => void removeAll()} disabled={saving}>Remove codes</Button>
          </>
        ) : undefined
      }
    >
      {mode === "replace" ? (
        <RecoveryCodesImporter
          previous={set}
          busy={saving}
          applyLabel="Save codes"
          onCancel={() => setMode("list")}
          onApply={replace}
        />
      ) : mode === "remove" ? (
        <p className="danger-copy">
          All {set?.codes.length ?? 0} recovery codes for “{credential.name}” will be removed from this credential. Make sure you have another way back into the account.
        </p>
      ) : !set ? (
        <p className="recovery-hint">No recovery codes are saved for this credential.</p>
      ) : (
        <div className="stack">
          <p className={`recovery-remaining ${isRecoveryCodeSetLow(set) ? "recovery-remaining-low" : ""}`.trim()} role="status">
            {remaining} of {set.codes.length} codes remaining
          </p>
          {isRecoveryCodeSetLow(set) && (
            <Alert variant="danger">
              {remaining === 0 ? "Every code has been used." : "You are running out of recovery codes."} Generate a new set in the service&apos;s security settings, then replace them here.
            </Alert>
          )}
          <ul className="recovery-code-list" aria-label="Recovery codes">
            {set.codes.map((item, index) => {
              const used = item.usedAt !== null;
              return (
                <li key={item.code} className={used ? "recovery-code-used" : undefined}>
                  <code>{item.code}</code>
                  <span className="recovery-code-state">{used ? `Used ${formatUsedAt(item.usedAt as string)}` : "Unused"}</span>
                  <span className="recovery-code-actions">
                    <IconButton
                      label={`Copy recovery code ${index + 1}`}
                      loading={copying === item.code}
                      onClick={() => void copy(item.code, used)}
                    >
                      <Icon icon={Copy01Icon} size={16} />
                    </IconButton>
                    <Button
                      className="btn-small"
                      aria-pressed={used}
                      loading={savingCode === item.code}
                      loadingLabel="Saving"
                      disabled={savingCode !== null}
                      onClick={() => void markUsed(item.code, !used)}
                    >
                      {used ? "Mark unused" : "Mark used"}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <button type="button" className="recovery-remove-link" onClick={() => setMode("remove")}>
            Remove all recovery codes
          </button>
        </div>
      )}
    </Modal>
  );
}
