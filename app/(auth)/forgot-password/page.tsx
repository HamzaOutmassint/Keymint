"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert02Icon, Mail01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const forgotPasswordSchema = z.object({ email: z.email("Enter a valid email address") });
type Form = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const form = useForm<Form>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submit(values: Form) {
    setError("");
    const result = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: "/reset-password",
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to send a reset link");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="auth-page">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <LogoMark />
          </div>
          <h1>Check your inbox</h1>
          <p>We have sent instructions if that email belongs to a Keymint account.</p>
        </div>
        <section className="card auth-card stack" aria-labelledby="email-sent-title">
          <div className="security-note">
            <Icon icon={Alert02Icon} size={17} />
            The reset link expires in one hour.
          </div>
          <div className="stack-sm">
            <h2 id="email-sent-title" className="page-title">Open the reset link</h2>
            <p className="page-subtitle">
              Follow the link in the email to choose a new sign-in password. Check your spam folder if it does not arrive soon.
            </p>
          </div>
          <Link href="/login" className="link">Back to sign in</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark">
          <LogoMark />
        </div>
        <h1>Reset your sign-in</h1>
        <p>
          Keep the boundary between account access and vault encryption clear.
        </p>
      </div>
      <section className="card auth-card stack" aria-labelledby="reset-title">
        <div className="security-note">
          <Icon icon={Alert02Icon} size={17} />
          Vault data cannot be reset through email.
        </div>
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <div className="stack-sm">
            <h2 id="reset-title" className="page-title">Reset your login password</h2>
            <p className="page-subtitle">
              Enter your account email and we will send a one-hour reset link.
            </p>
          </div>
          <FormField
            label="Email address"
            htmlFor="reset-email"
            error={form.formState.errors.email?.message}
          >
            <div className="input-shell">
              <Icon icon={Mail01Icon} size={17} />
              <input
                id="reset-email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
            </div>
          </FormField>
          {error && <p role="alert" className="field-error">{error}</p>}
          <Button
            type="submit"
            variant="primary"
            className="btn-full"
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            loadingLabel="Sending reset link"
          >
            Send reset link
          </Button>
        </form>
        <Link href="/login" className="btn btn-full">Back to sign in</Link>
      </section>
    </div>
  );
}
