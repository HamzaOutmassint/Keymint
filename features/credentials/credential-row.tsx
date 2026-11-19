"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  Key01Icon,
  Mail01Icon,
  StarIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, IconButton, Modal } from "@/components/ui";
import { CredentialFormModal } from "./credential-form-modal";
import { RecoveryCodesViewer } from "./recovery-codes-viewer";
import type { Credential } from "@/types/vault";
import { copySensitiveText } from "@/features/security/clipboard";
import { useVaultMutations } from "@/features/vault/data";
import type { CredentialValueV1 } from "@/lib/vault-crypto";
import { logClientActivity } from "@/features/activity/log-client";
import { isRecoveryCodeSetLow, remainingRecoveryCodes, withRecoveryCodes } from "@/lib/recovery-codes";

type Purpose = "view" | "copy" | "edit" | "delete" | "codes";

function formatPasswordUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function CredentialRow({
  credential,
  quickActions = false,
}: {
  credential: Credential;
  quickActions?: boolean;
}) {
  const mutations = useVaultMutations();
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [editData, setEditData] = useState<
    (Credential & { password: string }) | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const recoveryCodes = credential.recoveryCodes ?? null;
  function closeVerify() {
    setPurpose(null);
    setSecret(null);
    setConfirmDelete(false);
  }

  function value(overrides: Partial<CredentialValueV1> = {}): CredentialValueV1 {
    // Carry recovery codes through so unrelated edits never drop them.
    return withRecoveryCodes({
      categoryId: credential.categoryId ?? null, email: credential.email ?? "",
      favorite: credential.favorite, lastViewedAt: credential.lastViewed ?? null,
      name: credential.name, notes: credential.notes ?? "", password: credential.password,
      passwordUpdatedAt: credential.passwordUpdatedAt, username: credential.username,
      website: credential.website ?? "", ...overrides,
    }, overrides.recoveryCodes ?? recoveryCodes);
  }

  async function verify(action = purpose) {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action === "delete") setConfirmDelete(true);
      else if (action === "codes") {
        setCodesOpen(true);
        closeVerify();
        await logClientActivity("RECOVERY_CODES_VIEWED");
      } else if (action === "edit") {
        setEditData(credential);
        closeVerify();
      } else if (action === "copy") {
        await copySensitiveText(credential.password);
        await logClientActivity("PASSWORD_COPIED");
        toast.success("Password copied; Keymint will try to clear it in 30 seconds");
        closeVerify();
      } else {
        setSecret(credential.password);
        await logClientActivity("PASSWORD_VIEWED");
      }
      if (action === "view" || action === "copy") void mutations.touchCredential(credential).catch(() => undefined);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await mutations.remove(credential.id);
      toast.success("Password deleted");
      closeVerify();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite() {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      await mutations.saveCredential(value({ favorite: !credential.favorite }), credential.id);
      toast.success(credential.favorite ? "Removed from favorites" : "Added to favorites");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setFavoriteBusy(false);
    }
  }

  const dialogTitle = confirmDelete
    ? "Delete this password?"
    : secret
      ? "Password revealed"
      : "Verify your identity";
  const dialogDescription = confirmDelete
    ? `Delete “${credential.name}” permanently. This cannot be undone.`
    : secret
      ? "Close this dialog when you have finished. The value is not retained by the page."
      : "This action uses the Vault Key already held by this browser session.";
  return (
    <>
      <div className={`credential-row ${quickActions ? "credential-row-quick" : ""}`}>
        <div className="credential-main">
          <span className="credential-icon">
            <Icon icon={Mail01Icon} size={18} />
          </span>
          <span className="credential-copy">
            <span className="credential-title-line">
              <span className="credential-name">{credential.name}</span>
              {recoveryCodes && (
                <span
                  className={`recovery-badge ${isRecoveryCodeSetLow(recoveryCodes) ? "recovery-badge-low" : ""}`.trim()}
                  title={`${remainingRecoveryCodes(recoveryCodes)} of ${recoveryCodes.codes.length} recovery codes unused`}
                >
                  {remainingRecoveryCodes(recoveryCodes) === 0
                    ? "No codes left"
                    : `${remainingRecoveryCodes(recoveryCodes)}/${recoveryCodes.codes.length} codes`}
                </span>
              )}
            </span>
            <span className="credential-user">
              {credential.username || credential.email || "No username saved"}
            </span>
            {quickActions && secret !== null && <code className="credential-secret">{secret}</code>}
          </span>
        </div>
        {!quickActions && <time
          className="credential-updated"
          dateTime={credential.passwordUpdatedAt}
          title={new Date(credential.passwordUpdatedAt).toLocaleString()}
        >
          <span>Password updated</span>
          {formatPasswordUpdatedAt(credential.passwordUpdatedAt)}
        </time>}
        <span className="row-actions">
          <IconButton
            label={`${quickActions && secret !== null ? "Hide" : "Reveal"} ${credential.name} password`}
            aria-pressed={quickActions ? secret !== null : undefined}
            loading={quickActions && busy}
            onClick={() => {
              if (!quickActions) setPurpose("view");
              else if (secret !== null) setSecret(null);
              else void verify("view");
            }}
          >
            <Icon icon={ViewIcon} size={18} />
          </IconButton>
          <IconButton
            label={`Copy ${credential.name} password`}
            loading={quickActions && busy}
            onClick={() => quickActions ? void verify("copy") : setPurpose("copy")}
          >
            <Icon icon={Copy01Icon} size={18} />
          </IconButton>
          {!quickActions && recoveryCodes && <IconButton
            label={`Show ${credential.name} recovery codes`}
            onClick={() => setPurpose("codes")}
          >
            <Icon icon={Key01Icon} size={18} />
          </IconButton>}
          {!quickActions && <IconButton
            label={`Edit ${credential.name}`}
            onClick={() => setPurpose("edit")}
          >
            <Icon icon={Edit02Icon} size={18} />
          </IconButton>}
          <IconButton
            className={credential.favorite ? "favorite-action" : ""}
            label={
              credential.favorite ? "Remove from favorites" : "Add to favorites"
            }
            aria-pressed={credential.favorite}
            onClick={toggleFavorite}
            loading={favoriteBusy}
            loadingLabel={
              credential.favorite
                ? `Removing ${credential.name} from favorites`
                : `Adding ${credential.name} to favorites`
            }
          >
            <Icon icon={StarIcon} size={18} />
          </IconButton>
          {!quickActions && <IconButton
            className="danger-action"
            label={`Delete ${credential.name}`}
            onClick={() => setPurpose("delete")}
          >
            <Icon icon={Delete02Icon} size={18} />
          </IconButton>}
        </span>
      </div>
      {!quickActions && <Modal
        open={purpose !== null}
        onClose={closeVerify}
        title={dialogTitle}
        description={dialogDescription}
        loading={busy}
        loadingLabel={
          confirmDelete
            ? `Deleting ${credential.name}`
            : purpose === "copy"
              ? `Copying ${credential.name} password`
              : purpose === "view"
                ? `Revealing ${credential.name} password`
                : purpose === "edit"
                  ? `Unlocking ${credential.name} for editing`
                  : purpose === "codes"
                    ? `Unlocking ${credential.name} recovery codes`
                  : `Verifying deletion of ${credential.name}`
        }
        footer={
          confirmDelete ? (
            <>
              <Button onClick={closeVerify}>Cancel</Button>
              <Button variant="danger" onClick={remove} disabled={busy}>
                Delete password
              </Button>
            </>
          ) : secret ? (
            <Button variant="primary" onClick={closeVerify}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={closeVerify}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => verify()}
                disabled={busy}
              >
                Verify and continue
              </Button>
            </>
          )
        }
      >
        {secret && !confirmDelete ? (
          <div className="secret-value">
            <code>{secret}</code>
            <IconButton
              label="Copy revealed password"
              loading={copyBusy}
              loadingLabel="Copying revealed password"
              onClick={async () => {
                if (copyBusy) return;
                setCopyBusy(true);
                try {
                  await copySensitiveText(secret);
                  await logClientActivity("PASSWORD_COPIED");
                  toast.success(
                    "Password copied; Keymint will try to clear it in 30 seconds",
                  );
                } catch {
                  toast.error("Password could not be copied");
                } finally {
                  setCopyBusy(false);
                }
              }}
            >
              <Icon icon={Copy01Icon} size={18} />
            </IconButton>
          </div>
        ) : !confirmDelete ? (
          <div className="security-note">
            Keymint will perform this operation with the locally unlocked Vault Key.
          </div>
        ) : (
          <p className="danger-copy">
            The password and its encrypted vault record will be removed
            permanently.
          </p>
        )}
      </Modal>}
      {!quickActions && <RecoveryCodesViewer
        credential={credential}
        open={codesOpen}
        onClose={() => setCodesOpen(false)}
      />}
      {!quickActions && <CredentialFormModal
        open={!!editData}
        edit={editData ?? undefined}
        onClose={() => setEditData(null)}
      />}
    </>
  );
}
