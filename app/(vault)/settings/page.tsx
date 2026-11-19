"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download01Icon,
  FloppyDiskIcon,
  Upload01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Alert, Button, FormField, Modal, api } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { authClient, useSession } from "@/lib/auth-client";
import { MAX_IMPORT_CONTENT_BYTES } from "@/lib/import-policy";
import { canonicalizeJson, MAX_BACKUP_FILE_BYTES, parseBackup, serializeBackup, type CategoryPayloadV1, type CredentialPayloadV1, type VaultPayload, type VaultPayloadBase, type WrappedVaultKeyEnvelope } from "@/lib/vault-crypto";
import { vaultCryptoClient } from "@/features/vault/crypto-client";
import { downloadVaultRecoveryMaterial } from "@/features/vault/unlock-client";
import { useVaultData, useVaultMutations } from "@/features/vault/data";
import { downloadLocalFile, parseCredentialCsv, serializeCredentialCsv } from "@/features/vault/transfer";
import { credentialSchema } from "@/features/credentials/schemas";
import { SecurityCenter } from "@/features/settings/security-center";
import { EmailChangeControl } from "@/features/settings/email-change-control";
import { logClientActivity } from "@/features/activity/log-client";

type DialogName =
  | null
  | "login"
  | "master"
  | "rotate"
  | "export"
  | "import";
export default function SettingsPage() {
  const session = useSession();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogName>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [profileName, setProfileName] = useState<string | undefined>();
  const [profileImage, setProfileImage] = useState<string | undefined>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const currentProfileName = session.data?.user.name ?? "";
  const currentProfileEmail = session.data?.user.email ?? "";
  const profileDirty =
    profileName !== undefined || profileImage !== undefined;
  const save = useMutation({
    mutationFn: async () => {
      await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: profileName ?? currentProfileName,
          image: profileImage ?? session.data?.user.image ?? "",
        }),
      });
      await logClientActivity("SETTINGS_CHANGED");
    },
    onSuccess: async () => {
      toast.success("Settings saved");
      setProfileName(undefined);
      setProfileImage(undefined);
      await session.refetch();
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  function choosePhoto(file?: File) {
    if (!file) return;
    if (file.size > 500_000) {
      toast.error("Choose an image smaller than 500 KB");
      return;
    }
    const reader = new FileReader();
    setPhotoBusy(true);
    reader.onload = () => {
      setProfileImage(String(reader.result));
      setPhotoBusy(false);
    };
    reader.onerror = () => {
      toast.error("Profile photo could not be read");
      setPhotoBusy(false);
    };
    reader.readAsDataURL(file);
  }
  const shownImage = profileImage ?? session.data?.user.image ?? undefined;
  return (
    <div
      className="page"
      aria-busy={
        save.isPending || photoBusy
          ? "true"
          : undefined
      }
    >
      <PageHeader
        title="Settings"
        description="Manage account details, protection, preferences, and vault data."
        actions={
          <Button
              variant="primary"
              icon={<Icon icon={FloppyDiskIcon} size={16} />}
              onClick={() => save.mutate()}
              disabled={!profileDirty || save.isPending}
              loading={save.isPending}
              loadingLabel="Saving account settings"
            >
              Save changes
          </Button>
        }
      />
      <SettingsSection icon={UserIcon} title="Account">
        <div className="settings-profile">
          <div className="settings-profile-avatar">
            <span
              className="avatar"
              style={
                shownImage
                  ? { backgroundImage: `url(${shownImage})` }
                  : undefined
              }
            >
              {shownImage
                ? ""
                : session.data?.user.name?.slice(0, 1).toUpperCase()}
            </span>
            <input
              ref={photoRef}
              id="profile-photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => choosePhoto(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              className="btn-small"
              onClick={() => photoRef.current?.click()}
              disabled={photoBusy}
              loading={photoBusy}
              loadingLabel="Reading profile photo"
            >
              Change photo
            </Button>
          </div>
          <FormField label="Full name" htmlFor="profile-name">
            <input
              id="profile-name"
              className="input"
              value={profileName ?? currentProfileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </FormField>
          <EmailChangeControl currentEmail={currentProfileEmail} />
          <div className="settings-profile-password">
            <FormField label="Login password" htmlFor="profile-password">
              <div className="settings-password-control">
                <input
                  id="profile-password"
                  className="input"
                  value="••••••••••••••"
                  readOnly
                />
                <Button onClick={() => setDialog("login")}>
                  Change password
                </Button>
              </div>
            </FormField>
          </div>
        </div>
      </SettingsSection>
      <SecurityCenter />
      <SettingsSection icon={UserIcon} title="Vault access">
        <SettingRow
          title="Master Password"
          description="Change how the Vault Key is unlocked. Credential ciphertext stays unchanged."
        >
          <Button onClick={() => setDialog("master")}>Change Master Password</Button>
        </SettingRow>
        <SettingRow
          title="Rotate Vault Key"
          description="Create a fresh Vault Key and re-encrypt every record through a resumable, atomic migration."
        >
          <Button onClick={() => setDialog("rotate")}>Rotate Vault Key</Button>
        </SettingRow>
      </SettingsSection>
      <SettingsSection icon={Download01Icon} title="Vault data">
        <SettingRow
          title="Export vault data"
          description="Download an encrypted JSON backup or a portable CSV."
        >
          <Button
            icon={<Icon icon={Download01Icon} size={16} />}
            onClick={() => setDialog("export")}
          >
            Export data
          </Button>
        </SettingRow>
        <SettingRow
          title="Import vault data"
          description="Import an encrypted Keymint JSON archive or CSV."
        >
          <Button
            icon={<Icon icon={Upload01Icon} size={16} />}
            onClick={() => setDialog("import")}
          >
            Import data
          </Button>
        </SettingRow>
      </SettingsSection>
      <SettingsDialogs
        dialog={dialog}
        close={() => setDialog(null)}
        fileRef={fileRef}
      />
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  children,
}: {
  icon: typeof UserIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">
        <Icon icon={icon} size={18} />
        {title}
      </h2>
      <div className="card settings-card">{children}</div>
    </section>
  );
}
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function SettingsDialogs({
  dialog,
  close,
  fileRef,
}: {
  dialog: DialogName;
  close: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const vault = useVaultData();
  const vaultMutations = useVaultMutations();
  const [values, setValues] = useState<Record<string, string>>({
    format: "json",
    strategy: "skip",
    protection: "passphrase",
  });
  const recoveryKeyFileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rotationRecoveryKey, setRotationRecoveryKey] = useState<string | null>(null);
  const [rotationId, setRotationId] = useState<string | null>(null);
  function finish() {
    if (dialog === "rotate") {
      void vaultCryptoClient.abortKeyRotation().catch(() => undefined);
      if (rotationId) {
        void api(`/api/v2/vault/rotation?rotationId=${encodeURIComponent(rotationId)}`, {
          method: "DELETE",
          headers: { "Keymint-Vault-Protocol": "2" },
        }).catch(() => undefined);
      }
    }
    close();
    setValues({ format: "json", strategy: "skip", protection: "passphrase" });
    setRotationRecoveryKey(null);
    setRotationId(null);
  }
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      if (dialog === "login") {
        const result = await authClient.changePassword({
          currentPassword: values.current ?? "",
          newPassword: values.next ?? "",
          revokeOtherSessions: true,
        });
        if (result.error) throw new Error(result.error.message);
        await logClientActivity("SETTINGS_CHANGED");
        toast.success("Login password updated");
      } else if (dialog === "master") {
        if ((values.next ?? "").length < 12) throw new Error("Use a Master Password of at least 12 characters");
        if (values.next !== values.confirm) throw new Error("New Master Passwords do not match");
        await api("/api/security/reauth", {
          method: "POST",
          body: JSON.stringify({ password: values.accountPassword ?? "" }),
        });
        const masterWrapper = await vaultCryptoClient.createMasterRewrap(values.next);
        const stored = await api<{ masterWrapper: WrappedVaultKeyEnvelope }>(
          "/api/v2/vault/wrappers/master",
          {
            method: "PUT",
            headers: { "Keymint-Vault-Protocol": "2" },
            body: JSON.stringify({ masterWrapper }),
          },
        );
        if (canonicalizeJson(stored.masterWrapper) !== canonicalizeJson(masterWrapper)) {
          throw new Error("Stored Master Password wrapper did not match the local change");
        }
        await vaultCryptoClient.adoptMasterRewrap(values.next, stored.masterWrapper);
        await logClientActivity("SETTINGS_CHANGED");
        localStorage.setItem("keymint-vault-wrapper-change", crypto.randomUUID());
        toast.success("Master Password updated; credential ciphertext was not changed");
      } else if (dialog === "rotate") {
        if (!vault.data) throw new Error("Unlock and synchronize the vault before rotating its key");
        if (!rotationRecoveryKey) {
          if ((values.next ?? "").length < 12) throw new Error("Use a Master Password of at least 12 characters");
          if (values.next !== values.confirm) throw new Error("New Master Passwords do not match");
          await api("/api/security/reauth", {
            method: "POST",
            body: JSON.stringify({ password: values.accountPassword ?? "" }),
          });
          const pending = await vaultCryptoClient.beginKeyRotation(values.next ?? "");
          setRotationRecoveryKey(pending.recoveryKey);
          toast.success("Save and confirm the new Recovery Key to continue");
          return;
        }
        const wrappers = await vaultCryptoClient.confirmKeyRotation(values.rotationRecoveryConfirmation ?? "");
        await api("/api/security/reauth", {
          method: "POST",
          body: JSON.stringify({ password: values.accountPassword ?? "" }),
        });
        const nextRotationId = rotationId ?? crypto.randomUUID();
        if (!rotationId) {
          await api("/api/v2/vault/rotation", {
            method: "POST",
            headers: { "Keymint-Vault-Protocol": "2" },
            body: JSON.stringify({ rotationId: nextRotationId, ...wrappers }),
          });
          setRotationId(nextRotationId);
        }
        for (let index = 0; index < vault.data.envelopes.length; index += 100) {
          const records = await vaultCryptoClient.rotateRecordEnvelopes(
            vault.data.envelopes.slice(index, index + 100),
          );
          await api("/api/v2/vault/rotation/records", {
            method: "PUT",
            headers: { "Keymint-Vault-Protocol": "2" },
            body: JSON.stringify({ rotationId: nextRotationId, records }),
          });
        }
        await api("/api/security/reauth", {
          method: "POST",
          body: JSON.stringify({ password: values.accountPassword ?? "" }),
        });
        await api("/api/v2/vault/rotation/commit", {
          method: "POST",
          headers: { "Keymint-Vault-Protocol": "2" },
          body: JSON.stringify({ rotationId: nextRotationId }),
        });
        await vaultCryptoClient.adoptKeyRotation();
        await logClientActivity("SETTINGS_CHANGED");
        localStorage.setItem("keymint-vault-wrapper-change", crypto.randomUUID());
        toast.success("Vault Key rotated and every record re-encrypted");
        window.location.reload();
        return;
      } else if (dialog === "export") {
        if (!vault.data) throw new Error("Unlock and synchronize the vault before exporting");
        const stamp = new Date().toISOString().slice(0, 10);
        if (values.format === "csv") {
          downloadLocalFile(serializeCredentialCsv(vault.data.credentials), "text/csv;charset=utf-8", `keymint-${stamp}.csv`);
        } else if (values.format === "recovery") {
          if ((values.recoveryKey ?? "").length < 58) throw new Error("Enter your complete Recovery Key");
          const material = await downloadVaultRecoveryMaterial();
          const envelope = await vaultCryptoClient.exportRecoveryBackup(
            vault.data.envelopes,
            values.recoveryKey,
            material.recoveryWrapper,
          );
          const bytes = serializeBackup(envelope);
          downloadLocalFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "application/vnd.keymint.vault-backup+json", `keymint-${stamp}.kmvault`);
        } else {
          if ((values.passphrase ?? "").length < 12) throw new Error("Use a backup passphrase of at least 12 characters");
          const envelope = await vaultCryptoClient.exportBackup(vault.data.envelopes, values.passphrase);
          const bytes = serializeBackup(envelope);
          downloadLocalFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "application/vnd.keymint.vault-backup+json", `keymint-${stamp}.kmvault`);
        }
        await logClientActivity("VAULT_EXPORTED");
        toast.success("Vault export created locally");
      } else if (dialog === "import") {
        const file = fileRef.current?.files?.[0];
        if (!file) throw new Error("Choose a file to import");
        const isCsv = file.name.toLocaleLowerCase().endsWith(".csv");
        if (file.size > (isCsv ? MAX_IMPORT_CONTENT_BYTES : MAX_BACKUP_FILE_BYTES))
          throw new Error("The import file is too large");
        if (!vault.data) throw new Error("Unlock and synchronize the vault before importing");
        if (isCsv) {
          const rows = parseCredentialCsv(await file.text());
          const knownCategories = new Map(vault.data.categories.map((item) => [item.name.toLocaleLowerCase(), item.id]));
          const knownCredentials = new Map(vault.data.credentials.map((item) => [`${item.name}\u0000${item.username}`.toLocaleLowerCase(), item.id]));
          for (const row of rows) {
            const parsed = credentialSchema.parse({
              name: row.name, username: row.username, email: row.email, website: row.website,
              password: row.password, notes: row.notes, favorite: row.favorite.toLocaleLowerCase() === "true",
            });
            let categoryId: string | null = null;
            if (row.category) {
              categoryId = knownCategories.get(row.category.toLocaleLowerCase()) ?? null;
              if (!categoryId) {
                const category = await vaultMutations.saveCategory({ name: row.category.slice(0, 80), color: "#3B82F6", icon: "folder", pinned: false });
                categoryId = category.id;
                knownCategories.set(row.category.toLocaleLowerCase(), categoryId);
              }
            }
            const signature = `${parsed.name}\u0000${parsed.username}`.toLocaleLowerCase();
            const existingId = knownCredentials.get(signature);
            if (existingId && values.strategy === "skip") continue;
            const now = new Date().toISOString();
            const saved = await vaultMutations.saveCredential({
              categoryId, email: parsed.email ?? "", favorite: parsed.favorite, lastViewedAt: null,
              name: parsed.name, notes: parsed.notes ?? "", password: parsed.password,
              passwordUpdatedAt: now, username: parsed.username, website: parsed.website ?? "",
            }, existingId);
            knownCredentials.set(signature, saved.id);
          }
        } else {
          const parsedBackup = parseBackup(new Uint8Array(await file.arrayBuffer()));
          let payloads: VaultPayload[];
          if (parsedBackup.protected.protection === "recovery-key") {
            if (values.protection !== "recovery-key") {
              throw new Error("Choose Recovery Key protection for this backup");
            }
            payloads = await vaultCryptoClient.openRecoveryBackup(parsedBackup, values.recoveryKey ?? "");
          } else {
            if (values.protection !== "passphrase") {
              throw new Error("Choose Backup passphrase protection for this backup");
            }
            payloads = await vaultCryptoClient.openBackup(parsedBackup, { type: "passphrase", passphrase: values.passphrase ?? "" });
          }
          const categoryMap = new Map<string, string>();
          const recordMap = new Map<string, string>();
          for (const payload of payloads.filter((item): item is CategoryPayloadV1 => item.type === "category")) {
            const existing = vault.data.categories.find((item) => item.name.toLocaleLowerCase() === payload.value.name.toLocaleLowerCase());
            const saved = existing ?? await vaultMutations.saveCategory(payload.value);
            categoryMap.set(payload.id, saved.id);
            recordMap.set(payload.id, saved.id);
          }
          for (const payload of payloads.filter((item): item is CredentialPayloadV1 => item.type === "credential")) {
            const existing = vault.data.credentials.find((item) =>
              item.name.toLocaleLowerCase() === payload.value.name.toLocaleLowerCase() &&
              item.username.toLocaleLowerCase() === payload.value.username.toLocaleLowerCase());
            if (existing && values.strategy === "skip") {
              recordMap.set(payload.id, existing.id);
              continue;
            }
            const saved = await vaultMutations.saveCredential({
              ...payload.value,
              categoryId: payload.value.categoryId ? categoryMap.get(payload.value.categoryId) ?? null : null,
            }, existing?.id);
            recordMap.set(payload.id, saved.id);
          }
          for (const payload of payloads.filter((item): item is VaultPayloadBase => item.type === "vaultSettings" || item.type === "vaultActivity")) {
            const existing = payload.type === "vaultSettings"
              ? vault.data.payloads.find((item) => item.type === "vaultSettings")
              : undefined;
            if (existing && values.strategy === "skip") continue;
            const value = payload.type === "vaultActivity"
              ? { ...payload.value, recordId: typeof payload.value.recordId === "string" ? recordMap.get(payload.value.recordId) ?? null : null }
              : payload.value;
            await vaultMutations.saveRecord(payload.type, value, existing?.id);
          }
        }
        await logClientActivity("VAULT_IMPORTED");
        toast.success("Vault import encrypted and stored");
      }
      finish();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    dialog === "login"
      ? "Change Login Password"
      : dialog === "master"
        ? "Change Master Password"
        : dialog === "rotate"
          ? "Rotate Vault Key"
        : dialog === "export"
          ? "Export Vault"
          : "Import Vault";
  const busyLabel =
    dialog === "export"
        ? "Exporting vault data"
        : dialog === "import"
          ? "Importing vault data"
          : dialog === "master"
            ? "Changing Master Password"
            : dialog === "rotate"
              ? "Rotating Vault Key"
            : dialog === "login"
              ? "Changing login password"
              : "Updating settings";
  return (
    <Modal
      open={!!dialog}
      onClose={finish}
      title={title}
      loading={busy}
      loadingLabel={busyLabel}
      footer={
        <>
          <Button onClick={finish} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={run}
            disabled={busy}
          >
            Continue
          </Button>
        </>
      }
    >
      {(dialog === "login" || dialog === "master") && (
        <>
          {dialog === "login" && <PasswordField
            id="current-password"
            label="Current Login Password"
            autoFocus
            onChange={(value) => setValues({ ...values, current: value })}
          />}
          <PasswordField
            id="new-password"
            label={
              dialog === "login" ? "New Login Password" : "New Master Password"
            }
            onChange={(value) => setValues({ ...values, next: value })}
          />
          {dialog === "master" && (
            <>
              <PasswordField
                id="confirm-login-password-for-master-change"
                label="Current Login Password"
                onChange={(value) => setValues({ ...values, accountPassword: value })}
                autoFocus
              />
              <PasswordField
                id="confirm-new-master-password"
                label="Confirm new Master Password"
                onChange={(value) => setValues({ ...values, confirm: value })}
              />
              <Alert variant="info">
                This replaces only the encrypted Vault Key wrapper. Vault records are not downloaded, decrypted, or rewritten.
              </Alert>
              <aside
                className="master-password-requirements"
                aria-label="Master Password requirements"
              >
                <strong>Password requirements</strong>
                <ul>
                  <li>Use at least 12 characters.</li>
                  <li>Use no more than 256 characters.</li>
                  <li>Choose a unique passphrase you do not use elsewhere.</li>
                </ul>
              </aside>
            </>
          )}
        </>
      )}
      {dialog === "rotate" && (
        <>
          {!rotationRecoveryKey ? (
            <>
              <Alert variant="danger">
                This creates a new Vault Key, re-encrypts every record locally, and retires the old key. Keep this page open until it finishes.
              </Alert>
              <PasswordField
                id="rotation-login-password"
                label="Current Login Password"
                onChange={(value) => setValues({ ...values, accountPassword: value })}
                autoFocus
              />
              <PasswordField
                id="rotation-master-password"
                label="New Master Password"
                onChange={(value) => setValues({ ...values, next: value })}
              />
              <PasswordField
                id="rotation-confirm-master-password"
                label="Confirm new Master Password"
                onChange={(value) => setValues({ ...values, confirm: value })}
              />
            </>
          ) : (
            <>
              <Alert variant="danger">The old Recovery Key will stop working after the atomic cutover.</Alert>
              <div className="recovery-key-ticket" aria-label="New Recovery Key">
                <span>Keymint Vault Protocol V2</span>
                <code>{rotationRecoveryKey}</code>
              </div>
              <Button
                type="button"
                onClick={() => downloadLocalFile(
                  `Keymint Vault Recovery Key\n\n${rotationRecoveryKey}\n\nKeep this file private and separate from your device.\n`,
                  "text/plain;charset=utf-8",
                  "keymint-recovery-key.txt",
                )}
              >
                Download Recovery Key
              </Button>
              <FormField
                label="Confirm the complete Recovery Key"
                htmlFor="rotation-recovery-confirmation"
                description="Re-enter the key from your saved copy before re-encryption begins."
              >
                <textarea
                  id="rotation-recovery-confirmation"
                  className="input recovery-key-input"
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  value={values.rotationRecoveryConfirmation ?? ""}
                  onChange={(event) => setValues({ ...values, rotationRecoveryConfirmation: event.target.value })}
                />
              </FormField>
            </>
          )}
        </>
      )}
      {dialog === "export" && (
        <>
          <Alert variant="info">Backup Format V2 files are created and protected entirely in this browser.</Alert>
          <FormField label="Export format" htmlFor="export-format">
            <select
              id="export-format"
              className="select"
              value={values.format}
              onChange={(event) =>
                setValues({ ...values, format: event.target.value })
              }
            >
              <option value="json">Encrypted JSON</option>
              <option value="recovery">Encrypted with Recovery Key</option>
              <option value="csv">CSV (portable decrypted export)</option>
            </select>
          </FormField>
          {values.format === "csv" && (
            <Alert variant="danger">
              CSV exports decrypted data. Store it securely and delete it when
              you are finished. CSV does not include saved recovery codes; use an
              encrypted backup to keep them.
            </Alert>
          )}
          {values.format === "json" && (
            <PasswordField id="export-passphrase" label="Backup passphrase" onChange={(passphrase) => setValues({ ...values, passphrase })} />
          )}
          {values.format === "recovery" && (
            <FormField label="Recovery Key" htmlFor="export-recovery-key" description="The key is verified against this vault before the backup is created.">
              <textarea
                id="export-recovery-key"
                className="input recovery-key-input"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                value={values.recoveryKey ?? ""}
                onChange={(event) => setValues({ ...values, recoveryKey: event.target.value })}
              />
            </FormField>
          )}
        </>
      )}
      {dialog === "import" && (
        <>
          <Alert variant="info">V2 backups are opened locally. File contents are never uploaded.</Alert>
          <FormField label="Import file" htmlFor="import-file">
            <input
              ref={fileRef}
              id="import-file"
              className="input"
              type="file"
              accept=".kmvault,.csv"
            />
          </FormField>
          <FormField label="Encrypted backup protection" htmlFor="import-protection">
            <select
              id="import-protection"
              className="select"
              value={values.protection}
              onChange={(event) => setValues({ ...values, protection: event.target.value })}
            >
              <option value="passphrase">Backup passphrase</option>
              <option value="recovery-key">Recovery Key</option>
            </select>
          </FormField>
          {values.protection !== "recovery-key" ? (
            <PasswordField
              id="import-passphrase"
              label="Backup passphrase"
              onChange={(passphrase) => setValues({ ...values, passphrase })}
            />
          ) : (
            <>
              <FormField label="Recovery Key" htmlFor="import-recovery-key">
                <textarea
                  id="import-recovery-key"
                  className="input recovery-key-input"
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  value={values.recoveryKey ?? ""}
                  onChange={(event) => setValues({ ...values, recoveryKey: event.target.value })}
                />
              </FormField>
              <input
                ref={recoveryKeyFileRef}
                type="file"
                accept=".txt,.key,text/plain"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1024) {
                    toast.error("Recovery Key files must be smaller than 1 KB");
                    return;
                  }
                  setValues({ ...values, recoveryKey: (await file.text()).trim() });
                }}
              />
              <Button type="button" onClick={() => recoveryKeyFileRef.current?.click()}>
                Import Recovery Key file
              </Button>
            </>
          )}
          <FormField label="Duplicates" htmlFor="import-strategy">
            <select
              id="import-strategy"
              className="select"
              value={values.strategy}
              onChange={(event) =>
                setValues({ ...values, strategy: event.target.value })
              }
            >
              <option value="skip">Skip existing credentials</option>
              <option value="replace">Replace existing credentials</option>
            </select>
          </FormField>
        </>
      )}
    </Modal>
  );
}
function PasswordField({
  id,
  label,
  onChange,
  autoFocus = false,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id}>
      <input
        id={id}
        className="input"
        data-autofocus={autoFocus || undefined}
        type="password"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}
