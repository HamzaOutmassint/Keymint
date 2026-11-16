"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Alert, Button, FormField, Modal, api } from "@/components/ui";
import { EMAIL_CHANGE_STAGES, type EmailChangeStage } from "@/lib/email-change-policy";

type PendingEmailChange = {
  newEmail: string;
  stage: EmailChangeStage;
  expiresAt: string;
  oldVerifiedAt: string | null;
};

function expiryLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EmailChangeControl({ currentEmail }: { currentEmail: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"start" | "resend" | "cancel" | null>(null);
  const pending = useQuery({
    queryKey: ["email-change-request"],
    queryFn: () =>
      api<PendingEmailChange | null>("/api/security/email-change/request"),
    enabled: Boolean(currentEmail),
  });

  function close() {
    if (busy) return;
    setOpen(false);
    setNewEmail("");
    setPassword("");
    setError("");
  }

  async function start() {
    if (busy) return;
    setBusy("start");
    setError("");
    try {
      await api("/api/security/email-change/request", {
        method: "POST",
        body: JSON.stringify({ newEmail, password }),
      });
      setPassword("");
      setNewEmail("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["email-change-request"] });
      toast.success("Check your current email to continue");
    } catch (requestError) {
      setPassword("");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The email change could not be started",
      );
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy("resend");
    try {
      await api("/api/security/email-change/resend", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["email-change-request"] });
      toast.success("A fresh verification email was sent");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to resend email");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (busy) return;
    setBusy("cancel");
    try {
      await api("/api/security/email-change/request", { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["email-change-request"] });
      toast.success("Email change cancelled");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to cancel request");
    } finally {
      setBusy(null);
    }
  }

  const request = pending.data;
  const waitingForNew = request?.stage === EMAIL_CHANGE_STAGES.next;
  return (
    <div className="settings-email-field">
      <FormField
        label="Email address"
        htmlFor="profile-email"
        description="Changing your email requires confirmation from both addresses."
      >
        <div className="settings-email-control">
          <input
            id="profile-email"
            className="input"
            type="email"
            autoComplete="email"
            value={currentEmail}
            readOnly
          />
          <Button type="button" onClick={() => setOpen(true)} disabled={!currentEmail || !!busy}>
            Change email
          </Button>
        </div>
      </FormField>

      {request && (
        <div className="email-change-pending" role="status">
          <div>
            <strong>{waitingForNew ? "New address awaiting verification" : "Current address awaiting confirmation"}</strong>
            <p>
              {waitingForNew
                ? `Open the email sent to ${request.newEmail}.`
                : `Confirm the message sent to ${currentEmail}.`} {" "}
              Expires {expiryLabel(request.expiresAt)}.
            </p>
          </div>
          <div className="email-change-pending-actions">
            <Button type="button" variant="ghost" onClick={cancel} loading={busy === "cancel"} loadingLabel="Cancelling request">
              Cancel
            </Button>
            <Button type="button" onClick={resend} loading={busy === "resend"} loadingLabel="Resending verification">
              Resend
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Change sign-in email"
        description="Both addresses must approve the change."
        loading={busy === "start"}
        loadingLabel="Starting email verification"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={!!busy}>Cancel</Button>
            <Button type="button" variant="primary" onClick={start} loading={busy === "start"} loadingLabel="Starting email verification" disabled={!newEmail || !password}>
              Send first verification
            </Button>
          </>
        }
      >
        <div className="email-change-steps" aria-label="Email change verification steps">
          <div className="email-change-step active"><span>1</span><strong>Current address</strong></div>
          <div className="email-change-step"><span>2</span><strong>New address</strong></div>
        </div>
        <Alert>
          After both addresses are verified, every device will be signed out. Your Master Password and encrypted vault will not change.
        </Alert>
        <FormField label="New email address" htmlFor="new-account-email">
          <input
            id="new-account-email"
            className="input"
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            data-autofocus
          />
        </FormField>
        <FormField label="Current login password" htmlFor="email-change-password" description="This confirms that the request came from you.">
          <input
            id="email-change-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </FormField>
        {error && <p className="field-error" role="alert">{error}</p>}
      </Modal>
    </div>
  );
}
