"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import {
  Mail01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { registerSchema } from "@/features/auth/schemas";

type Form = z.input<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const form = useForm<Form>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  async function submit(values: Form) {
    setError("");
    const result = await authClient.signUp.email(values);
    if (result.error) {
      setError(result.error.message ?? "Account creation was not completed");
      return;
    }
    form.reset();
    setVerificationSent(true);
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark">
          <LogoMark />
        </div>
        <h1>Create your account</h1>
        <p>Your sign-in and vault keys stay separate.</p>
      </div>
      <section className="card auth-card" aria-label="Create Keymint account">
        {verificationSent ? (
          <div className="stack-sm" role="status">
            <h2>Check your email</h2>
            <p>
              If registration was accepted, Keymint sent a verification link.
              Verify the address before signing in.
            </p>
            <Button variant="primary" onClick={() => router.push("/login")}>
              Return to sign in
            </Button>
          </div>
        ) : (
        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FormField
            label="Full name"
            htmlFor="register-name"
            error={form.formState.errors.name?.message}
          >
            <div className="input-shell">
              <Icon icon={UserIcon} size={17} />
              <input
                id="register-name"
                className="input"
                autoComplete="name"
                aria-invalid={!!form.formState.errors.name}
                {...form.register("name")}
              />
            </div>
          </FormField>
          <FormField
            label="Email address"
            htmlFor="register-email"
            error={form.formState.errors.email?.message}
          >
            <div className="input-shell">
              <Icon icon={Mail01Icon} size={17} />
              <input
                id="register-email"
                className="input"
                type="email"
                autoComplete="email"
                aria-invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
            </div>
          </FormField>
          <FormField
            label="Login password"
            htmlFor="register-password"
            error={form.formState.errors.password?.message}
            description="Use a strong password that you do not use elsewhere."
          >
            <input
              id="register-password"
              className="input"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
          </FormField>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            type="submit"
            className="btn-full"
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            loadingLabel="Creating your Keymint account"
          >
            Create account
          </Button>
        </form>
        )}
        <p className="auth-footer">
          Already have an account?{" "}
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      </section>
    </div>
  );
}
