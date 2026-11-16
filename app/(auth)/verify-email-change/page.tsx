"use client";

import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { useEffect, useState } from "react";
import { Alert, Button, api } from "@/components/ui";
import { EMAIL_CHANGE_TOKEN_PATTERN } from "@/lib/email-change-policy";

type Stage = "current" | "new";

export default function VerifyEmailChangePage() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentStage = fragment.get("stage");
    const fragmentToken = fragment.get("token") ?? "";
    window.history.replaceState({}, "", window.location.pathname);
    const validStage = fragmentStage === "current" || fragmentStage === "new"
      ? fragmentStage
      : null;
    const validToken = EMAIL_CHANGE_TOKEN_PATTERN.test(fragmentToken)
      ? fragmentToken
      : "";
    queueMicrotask(() => {
      if (validStage && validToken) {
        setStage(validStage);
        setToken(validToken);
      }
      setReady(true);
    });
  }, []);

  async function verify() {
    if (!stage || !token || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/security/email-change/verify-${stage}`, {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setToken("");
      setComplete(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "This verification could not be completed");
    } finally {
      setBusy(false);
    }
  }

  const valid = ready && stage && token;
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-mark"><LogoMark /></div>
        <h1>Secure email change</h1>
        <p>Two addresses, two confirmations, one account.</p>
      </div>
      <section className="card auth-card stack email-change-verification" aria-labelledby="email-change-title">
        <div className="email-change-steps" aria-label="Email change verification steps">
          <div className={`email-change-step ${stage === "current" || complete ? "active" : ""}`}><span>1</span><strong>Current address</strong></div>
          <div className={`email-change-step ${stage === "new" ? "active" : ""}`}><span>2</span><strong>New address</strong></div>
        </div>
        {!ready ? (
          <p>Reading the secure link...</p>
        ) : complete ? (
          <div className="stack-sm">
            <h2 id="email-change-title" className="page-title">
              {stage === "current" ? "Current address confirmed" : "Email address changed"}
            </h2>
            <p className="page-subtitle">
              {stage === "current"
                ? "A second verification link was sent to your new address. Open it to finish the change."
                : "Every Keymint session has been signed out. Sign in again with your new email address."}
            </p>
            {stage === "new" ? (
              <Link href="/login" className="btn btn-primary">Sign in with the new email</Link>
            ) : (
              <Alert>You can close this page after checking your new inbox.</Alert>
            )}
          </div>
        ) : valid ? (
          <div className="stack-sm">
            <h2 id="email-change-title" className="page-title">
              {stage === "current" ? "Confirm the requested change" : "Verify this new address"}
            </h2>
            <p className="page-subtitle">
              {stage === "current"
                ? "Your account email will not change yet. Confirming this step sends a separate link to the new address."
                : "Finishing this step changes your sign-in email and removes every signed-in device."}
            </p>
            {error && <p className="field-error" role="alert">{error}</p>}
            <Button variant="primary" onClick={verify} loading={busy} loadingLabel="Verifying email address">
              {stage === "current" ? "Confirm current address" : "Verify new address"}
            </Button>
          </div>
        ) : (
          <div className="stack-sm">
            <h2 id="email-change-title" className="page-title">This verification link is invalid</h2>
            <p className="page-subtitle">The link may be incomplete, expired, or already used. Start a new request from Settings.</p>
            <Link href="/login" className="btn">Return to sign in</Link>
          </div>
        )}
      </section>
    </div>
  );
}
