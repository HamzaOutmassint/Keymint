"use client";

import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/logo";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Key01Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField, api } from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { vaultCryptoClient } from "@/features/vault/crypto-client";
import { useVaultStore } from "@/features/vault/store";
import { downloadLocalFile } from "@/features/vault/transfer";

const schema = z
  .object({ masterPassword: z.string().min(12), confirm: z.string() })
  .refine((data) => data.masterPassword === data.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type Form = z.infer<typeof schema>;

export default function MasterPasswordPage() {
  const router = useRouter();
  const session = useSession();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { masterPassword: "", confirm: "" },
  });
  async function submit(values: Form) {
    try {
      const ownerId = session.data?.user.id;
      if (!ownerId) throw new Error("Authentication required");
      const result = await vaultCryptoClient.beginSetup(
        ownerId,
        crypto.randomUUID(),
        values.masterPassword,
      );
      setRecoveryKey(result.recoveryKey);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function finishSetup() {
    if (!recoveryKey || setupBusy) return;
    setSetupBusy(true);
    try {
      const { masterWrapper, recoveryWrapper } =
        await vaultCryptoClient.confirmSetup(recoveryConfirmation);
      await api("/api/v2/vault/setup", {
        method: "POST",
        headers: { "Keymint-Vault-Protocol": "2" },
        body: JSON.stringify({ masterWrapper, recoveryWrapper }),
      });
      useVaultStore.getState().setUnlocked(true);
      setRecoveryConfirmation("");
      setRecoveryKey(null);
      form.reset();
      toast.success("Your encrypted vault is ready");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark">
          <LogoMark />
        </div>
        <h1>Secure your vault</h1>
        <p>Create the key that encrypts everything you store.</p>
      </div>
      <section className="card auth-card" aria-label="Create master password">
        <div className="security-note">
          <Icon icon={Shield01Icon} size={17} />
          Keymint cannot recover this password for you.
        </div>
        {recoveryKey ? (
          <div className="recovery-key-panel">
            <div className="security-note">
              Save this Recovery Key outside Keymint. It will not be shown again.
            </div>
            <div className="recovery-key-ticket" aria-label="Recovery Key">
              <span>Keymint Vault Protocol V2</span>
              <code id="generated-recovery-key">{recoveryKey}</code>
            </div>
            <Button
              type="button"
              onClick={() => downloadLocalFile(
                `Keymint Vault Recovery Key\n\n${recoveryKey}\n\nKeep this file private and separate from your device.\n`,
                "text/plain;charset=utf-8",
                "keymint-recovery-key.txt",
              )}
            >
              Download Recovery Key
            </Button>
            <FormField
              label="Confirm Recovery Key"
              htmlFor="confirm-recovery-key"
              description="Re-enter the complete key to prove that your saved copy works."
            >
              <textarea
                id="confirm-recovery-key"
                className="input recovery-key-input"
                value={recoveryConfirmation}
                onChange={(event) => setRecoveryConfirmation(event.target.value)}
                rows={5}
              />
            </FormField>
            <Button
              variant="primary"
              type="button"
              className="btn-full"
              onClick={finishSetup}
              disabled={setupBusy || recoveryConfirmation.length < 58}
              loading={setupBusy}
              loadingLabel="Verifying encrypted key wrappers"
            >
              Confirm and create vault
            </Button>
          </div>
        ) : (
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FormField
            label="Master Password"
            htmlFor="master-password"
            error={form.formState.errors.masterPassword?.message}
            description="Use at least 12 characters and a unique passphrase."
          >
            <div className="input-shell">
              <Icon icon={Key01Icon} size={17} />
              <input
                id="master-password"
                className="input"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.masterPassword}
                {...form.register("masterPassword")}
              />
            </div>
          </FormField>
          <FormField
            label="Confirm Master Password"
            htmlFor="confirm-master-password"
            error={form.formState.errors.confirm?.message}
          >
            <input
              id="confirm-master-password"
              className="input"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.confirm}
              {...form.register("confirm")}
            />
          </FormField>
          <Button
            variant="primary"
            type="submit"
            className="btn-full"
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            loadingLabel="Encrypting your new vault"
          >
            Create encrypted vault
          </Button>
        </form>
        )}
      </section>
    </div>
  );
}
