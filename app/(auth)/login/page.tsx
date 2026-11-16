"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import {
  Key01Icon,
  LockPasswordIcon,
  Mail01Icon,
  Shield01Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField, IconButton, Modal, api } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { loginSchema } from "@/features/auth/schemas";

type Form = z.input<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [code, setCode] = useState("");
  const [factorMode, setFactorMode] = useState<"totp" | "recovery">("totp");
  const [trustDevice, setTrustDevice] = useState(false);
  const [factorBusy, setFactorBusy] = useState(false);
  const form = useForm<Form>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  async function completeLogin() {
    await api("/api/logs/event", {
      method: "POST",
      body: JSON.stringify({
        action: "LOGIN",
      }),
    }).catch(() => undefined);
    router.push("/");
    router.refresh();
  }

  async function submit(values: Form) {
    setError("");
    const result = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      rememberMe: values.rememberMe,
    });
    if (result.error) {
      setError(
        result.error.message ?? "Unable to sign in with those credentials",
      );
      return;
    }
    if (
      (result.data as unknown as { twoFactorRedirect?: boolean })
        ?.twoFactorRedirect
    ) {
      setTwoFactorPending(true);
      return;
    }
    await completeLogin();
  }

  async function verifyFactor() {
    if (factorBusy) return;
    setFactorBusy(true);
    try {
      const result = factorMode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
      if (result.error) {
        setError(result.error.message ?? "Enter a valid authentication code");
        return;
      }
      setTwoFactorPending(false);
      setCode("");
      setFactorMode("totp");
      setTrustDevice(false);
      await completeLogin();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setFactorBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark">
          <LogoMark />
        </div>
        <h1>Welcome to Keymint</h1>
        <p>Sign in to open your private vault.</p>
      </div>
      <section className="card auth-card" aria-label="Sign in">
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FormField
            label="Email address"
            htmlFor="login-email"
            error={form.formState.errors.email?.message}
          >
            <div className="input-shell">
              <Icon icon={Mail01Icon} size={17} />
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="username webauthn"
                placeholder="you@company.com"
                aria-invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
            </div>
          </FormField>
          <div className="form-group">
            <div className="label-row">
              <label htmlFor="login-password">Login password</label>
              <Link href="/forgot-password" className="link">
                Forgot password?
              </Link>
            </div>
            <div className="input-shell">
              <Icon icon={Key01Icon} size={17} />
              <input
                id="login-password"
                className="input"
                type={visible ? "text" : "password"}
                autoComplete="current-password webauthn"
                placeholder="Enter your password"
                aria-invalid={!!form.formState.errors.password}
                {...form.register("password")}
              />
              <IconButton
                type="button"
                className="input-action"
                label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                <Icon icon={visible ? ViewOffSlashIcon : ViewIcon} size={18} />
              </IconButton>
            </div>
            {form.formState.errors.password && (
              <span className="field-error" role="alert">
                {form.formState.errors.password.message}
              </span>
            )}
          </div>
          <div className="remember-me-option">
            <label className="check-row" htmlFor="remember-me">
              <input
                id="remember-me"
                type="checkbox"
                aria-describedby="remember-me-description"
                {...form.register("rememberMe")}
              />
              Keep me signed in
            </label>
            <p id="remember-me-description" className="form-help">
              Stay signed in for up to 7 days on this device. Leave this off on
              shared computers.
            </p>
          </div>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="btn-full"
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            loadingLabel="Signing in to Keymint"
            icon={<Icon icon={LockPasswordIcon} size={17} />}
          >
            Sign in
          </Button>
          <div className="auth-alternative" role="separator"><span>or</span></div>
          <Button
            type="button"
            className="btn-full"
            onClick={async () => {
              setError("");
              const result = await authClient.signIn.passkey();
              if (result.error) {
                setError(result.error.message ?? "Passkey sign-in was not completed");
                return;
              }
              await completeLogin();
            }}
            icon={<Icon icon={Shield01Icon} size={17} />}
          >
            Sign in with a passkey
          </Button>
        </form>
      </section>
      <div className="trust-note">
        <span>
          <Icon icon={Shield01Icon} size={15} />
          Encrypted vault
        </span>
        <span>
          <Icon icon={Shield01Icon} size={15} />
          Passkey ready
        </span>
      </div>
      <Modal
        open={twoFactorPending}
        onClose={() => {
          setTwoFactorPending(false);
          setCode("");
          setFactorMode("totp");
          setTrustDevice(false);
        }}
        title={factorMode === "totp" ? "Verify your identity" : "Use a recovery code"}
        description={factorMode === "totp" ? "Enter the six-digit code from your authenticator app." : "Enter one of the single-use recovery codes you saved during setup."}
        loading={factorBusy}
        loadingLabel="Verifying authentication code"
        footer={
          <Button
            variant="primary"
            onClick={verifyFactor}
            disabled={factorBusy || (factorMode === "totp" ? code.length !== 6 : code.length < 11)}
          >
            Verify code
          </Button>
        }
      >
        <FormField
          label={factorMode === "totp" ? "Authentication code" : "Recovery code"}
          htmlFor="two-factor-code"
          error={error}
        >
          <input
            id="two-factor-code"
            className="input"
            data-autofocus
            inputMode={factorMode === "totp" ? "numeric" : "text"}
            autoComplete={factorMode === "totp" ? "one-time-code" : "off"}
            maxLength={factorMode === "totp" ? 6 : 32}
            value={code}
            onChange={(event) => setCode(factorMode === "totp" ? event.target.value.replace(/\D/g, "") : event.target.value.trim())}
          />
        </FormField>
        <Button
          type="button"
          variant="ghost"
          onClick={() => { setFactorMode(factorMode === "totp" ? "recovery" : "totp"); setCode(""); setError(""); }}
        >
          {factorMode === "totp" ? "Use a recovery code" : "Use authenticator code"}
        </Button>
        <label className="check-row" htmlFor="trust-two-factor-device">
          <input
            id="trust-two-factor-device"
            type="checkbox"
            checked={trustDevice}
            onChange={(event) => setTrustDevice(event.target.checked)}
          />
          Trust this device for up to 14 days
        </label>
      </Modal>
    </div>
  );
}
