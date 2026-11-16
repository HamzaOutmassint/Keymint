"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Alert02Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters").max(128, "Use no more than 128 characters"),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type Form = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invalidLink = searchParams.get("error") === "INVALID_TOKEN" || !token;
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const form = useForm<Form>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function submit(values: Form) {
    if (!token) return;
    setError("");
    const result = await authClient.resetPassword({ newPassword: values.password, token });
    if (result.error) {
      setError(result.error.message ?? "Unable to reset your password");
      return;
    }
    form.reset();
    setComplete(true);
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark">
          <LogoMark />
        </div>
        <h1>Choose a new password</h1>
        <p>This updates your Keymint sign-in password only.</p>
      </div>
      <section className="card auth-card stack" aria-labelledby="new-password-title">
        <div className="security-note">
          <Icon icon={Alert02Icon} size={17} />
          Your Master Password and encrypted vault will not change.
        </div>
        {complete ? (
          <div className="stack-sm">
            <h2 id="new-password-title" className="page-title">
              Password reset
            </h2>
            <p className="page-subtitle">
              Your sign-in password has been updated and your other sessions
              have been signed out.
            </p>
            <Link href="/login" className="btn btn-primary">
              Sign in with your new password
            </Link>
          </div>
        ) : invalidLink ? (
          <div className="stack-sm">
            <h2 id="new-password-title" className="page-title">This reset link is invalid or has expired</h2>
            <p className="page-subtitle">Request a new reset link to continue.</p>
            <Link href="/forgot-password" className="btn btn-primary">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(submit)} noValidate>
            <h2 id="new-password-title" className="page-title">New sign-in password</h2>
            <FormField
              label="New password"
              htmlFor="new-password"
              error={form.formState.errors.password?.message}
              description="Use 12 to 128 characters."
            >
              <div className="input-shell">
                <Icon icon={Key01Icon} size={17} />
                <input
                  id="new-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
              </div>
            </FormField>
            <FormField label="Confirm new password" htmlFor="confirm-new-password" error={form.formState.errors.confirm?.message}>
              <input
                id="confirm-new-password"
                className="input"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!form.formState.errors.confirm}
                {...form.register("confirm")}
              />
            </FormField>
            {error && <p role="alert" className="field-error">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              className="btn-full"
              disabled={form.formState.isSubmitting}
              loading={form.formState.isSubmitting}
              loadingLabel="Updating password"
            >
              Reset sign-in password
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
