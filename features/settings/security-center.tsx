"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  ComputerIcon,
  Download01Icon,
  FingerPrintIcon,
  Key01Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Alert, Button, FormField, Modal, api } from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";
import { logClientActivity } from "@/features/activity/log-client";

type Dialog =
  | null
  | "totp"
  | "totp-disable"
  | "recovery-codes"
  | "passkey-add"
  | "passkey-delete";

type Enrollment = {
  totpURI: string;
  recoveryCodes: string[];
  expiresAt: string;
  replacing: boolean;
};

type PasskeyRecord = {
  id: string;
  name?: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date | string;
};

type SessionRecord = {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
};

function dateLabel(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function deviceLabel(userAgent?: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : "device";
  return `${browser} on ${os}`;
}

export function SecurityCenter() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [shownCodes, setShownCodes] = useState<string[]>([]);
  const [selectedPasskey, setSelectedPasskey] = useState<PasskeyRecord | null>(
    null,
  );
  const twoFactorEnabled = !!session.data?.user.twoFactorEnabled;
  const currentToken = session.data?.session.token;

  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []) as PasskeyRecord[];
    },
  });
  const sessions = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []) as SessionRecord[];
    },
  });

  function close() {
    setDialog(null);
    setPassword("");
    setCode("");
    setName("");
    setEnrollment(null);
    setShownCodes([]);
    setSelectedPasskey(null);
  }

  async function refreshSecurityState() {
    await Promise.all([
      session.refetch(),
      queryClient.invalidateQueries({ queryKey: ["passkeys"] }),
      queryClient.invalidateQueries({ queryKey: ["auth-sessions"] }),
    ]);
  }

  async function runDialogAction() {
    if (busy) return;
    setBusy(true);
    try {
      if (dialog === "totp") {
        if (!enrollment) {
          const next = await api<Enrollment>("/api/security/totp/enrollment", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          setEnrollment(next);
          setShownCodes(next.recoveryCodes);
          return;
        }
        await api("/api/security/totp/enrollment", {
          method: "PUT",
          body: JSON.stringify({ code }),
        });
        toast.success(
          enrollment.replacing
            ? "Authenticator replaced"
            : "Authenticator protection enabled",
        );
        await logClientActivity("SETTINGS_CHANGED");
        close();
        await refreshSecurityState();
        return;
      }
      if (dialog === "totp-disable") {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) throw new Error(result.error.message);
        toast.success("Authenticator protection disabled");
        await logClientActivity("SETTINGS_CHANGED");
        close();
        await refreshSecurityState();
        return;
      }
      if (dialog === "recovery-codes") {
        if (!shownCodes.length) {
          const result = await authClient.twoFactor.generateBackupCodes({
            password,
          });
          if (result.error) throw new Error(result.error.message);
          setShownCodes(result.data?.backupCodes ?? []);
          toast.success("Recovery codes replaced");
          await logClientActivity("SETTINGS_CHANGED");
          await refreshSecurityState();
          return;
        }
        close();
        return;
      }
      if (dialog === "passkey-add") {
        if (!name.trim())
          throw new Error("Name this passkey so you can recognize it later");
        await api("/api/security/reauth", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        const result = await authClient.passkey.addPasskey({
          name: name.trim(),
          authenticatorAttachment: "platform",
        });
        if (result.error) throw new Error(result.error.message);
        toast.success("Passkey added");
        await logClientActivity("SETTINGS_CHANGED");
        close();
        await refreshSecurityState();
        return;
      }
      if (dialog === "passkey-delete" && selectedPasskey) {
        await api("/api/security/passkeys/delete", {
          method: "POST",
          body: JSON.stringify({ id: selectedPasskey.id, password }),
        });
        toast.success("Passkey removed");
        await logClientActivity("SETTINGS_CHANGED");
        close();
        await refreshSecurityState();
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(token: string) {
    try {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(result.error.message);
      toast.success("Device signed out");
      await logClientActivity("SETTINGS_CHANGED");
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function revokeOtherSessions() {
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) throw new Error(result.error.message);
      toast.success("Other devices signed out");
      await logClientActivity("SETTINGS_CHANGED");
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="security-center-title"
    >
      <h2 id="security-center-title" className="settings-section-title">
        <Icon icon={Shield01Icon} size={18} />
        Security and sign-in
      </h2>
      <div className="card security-center-card">
        <div className="security-factor-block">
          <div className="security-factor-heading">
            <div className="security-factor-icon">
              <Icon icon={Key01Icon} size={20} />
            </div>
            <div>
              <div className="security-title-line">
                <strong>Authenticator app</strong>
                <span
                  className={
                    twoFactorEnabled ? "security-state is-on" : "security-state"
                  }
                >
                  {twoFactorEnabled ? "Protected" : "Not set up"}
                </span>
              </div>
              <p>
                Use a rotating code when a password sign-in comes from an
                untrusted device.
              </p>
            </div>
          </div>
          <div className="security-actions">
            <Button onClick={() => setDialog("totp")}>
              {twoFactorEnabled
                ? "Replace authenticator"
                : "Set up authenticator"}
            </Button>
            {twoFactorEnabled && (
              <>
                <Button onClick={() => setDialog("recovery-codes")}>
                  Replace recovery codes
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setDialog("totp-disable")}
                >
                  Turn off
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="security-factor-block passkey-block">
          <div className="passkey-thesis">
            <div className="security-factor-icon passkey-icon">
              <Icon icon={FingerPrintIcon} size={24} />
            </div>
            <div>
              <div className="security-title-line">
                <strong>Passkeys</strong>
                <span className="security-state is-on">Verified on device</span>
              </div>
              <p>
                Your face, fingerprint, or device PIN unlocks a signed
                credential. Keymint never receives the biometric.
              </p>
            </div>
            <Button variant="primary" onClick={() => setDialog("passkey-add")}>
              Add passkey
            </Button>
          </div>
          <div className="security-roster" aria-label="Registered passkeys">
            {passkeys.isPending ? (
              <p className="security-empty">Loading passkeys…</p>
            ) : !passkeys.data?.length ? (
              <p className="security-empty">
                No passkeys yet. Add one from a device only you unlock.
              </p>
            ) : (
              passkeys.data.map((passkey) => (
                <div className="security-roster-item" key={passkey.id}>
                  <Icon icon={FingerPrintIcon} size={18} />
                  <div>
                    <strong>{passkey.name || "Unnamed passkey"}</strong>
                    <span>
                      {passkey.backedUp ? "Synced" : "Device-bound"} · Added{" "}
                      {dateLabel(passkey.createdAt)}
                    </span>
                  </div>
                  <Button
                    aria-label={`Remove ${passkey.name || "passkey"}`}
                    onClick={() => {
                      setSelectedPasskey(passkey);
                      setDialog("passkey-delete");
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="security-factor-block">
          <div className="security-factor-heading sessions-heading">
            <div className="security-factor-icon">
              <Icon icon={ComputerIcon} size={20} />
            </div>
            <div>
              <strong>Signed-in devices</strong>
              <p>
                Remove sessions you no longer recognize. This device stays
                signed in when you remove all others.
              </p>
            </div>
            {(sessions.data?.length ?? 0) > 1 && (
              <Button onClick={revokeOtherSessions}>
                Sign out other devices
              </Button>
            )}
          </div>
          <div className="security-roster" aria-label="Signed-in devices">
            {sessions.data?.map((item) => {
              const current = item.token === currentToken;
              return (
                <div className="security-roster-item" key={item.id}>
                  <Icon icon={ComputerIcon} size={18} />
                  <div>
                    <strong>
                      {deviceLabel(item.userAgent)}{" "}
                      {current && (
                        <span className="current-device">This device</span>
                      )}
                    </strong>
                    <span>
                      {item.ipAddress || "IP unavailable"} · Signed in{" "}
                      {dateLabel(item.createdAt)}
                    </span>
                  </div>
                  {!current && (
                    <Button onClick={() => revokeSession(item.token)}>
                      Sign out
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal
        open={!!dialog}
        onClose={close}
        loading={busy}
        loadingLabel="Updating sign-in security"
        title={
          dialog === "totp"
            ? twoFactorEnabled
              ? "Replace authenticator"
              : "Set up authenticator"
            : dialog === "totp-disable"
              ? "Turn off authenticator protection"
              : dialog === "recovery-codes"
                ? "Replace recovery codes"
                : dialog === "passkey-add"
                  ? "Add a passkey"
                  : "Remove passkey"
        }
        description={
          dialog === "passkey-add"
            ? "Confirm your login password, then verify with this device."
            : dialog === "passkey-delete"
              ? "Confirm your login password before removing this sign-in factor."
              : undefined
        }
        footer={
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={
                dialog === "passkey-delete" || dialog === "totp-disable"
                  ? "danger"
                  : "primary"
              }
              onClick={runDialogAction}
              disabled={
                busy || (dialog === "totp" && !!enrollment && code.length !== 6)
              }
            >
              {dialog === "totp"
                ? enrollment
                  ? "Verify and activate"
                  : "Continue"
                : dialog === "recovery-codes" && shownCodes.length
                  ? "Done"
                  : dialog === "passkey-delete"
                    ? "Remove passkey"
                    : "Continue"}
            </Button>
          </>
        }
      >
        {(dialog === "totp" ||
          dialog === "totp-disable" ||
          (dialog === "recovery-codes" && !shownCodes.length) ||
          dialog === "passkey-add" ||
          dialog === "passkey-delete") &&
          !enrollment && (
            <>
              {dialog === "passkey-add" && (
                <FormField
                  label="Passkey name"
                  htmlFor="passkey-name"
                  description="For example, Work laptop or Pixel 10"
                >
                  <input
                    id="passkey-name"
                    className="input"
                    autoComplete="off"
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
              )}
              <FormField
                label="Login password"
                htmlFor="security-current-password"
              >
                <input
                  id="security-current-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FormField>
            </>
          )}
        {dialog === "totp" && enrollment && (
          <>
            <div className="qr-panel">
              <QRCodeSVG value={enrollment.totpURI} size={168} />
            </div>
            <Alert variant="info">
              The current authenticator remains active until this code is
              verified. Save the new recovery codes before continuing.
            </Alert>
            <RecoveryCodeGrid codes={shownCodes} />
            <FormField
              label="Six-digit code from the new authenticator"
              htmlFor="totp-replacement-code"
            >
              <input
                id="totp-replacement-code"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </FormField>
          </>
        )}
        {dialog === "recovery-codes" && shownCodes.length > 0 && (
          <>
            <Alert variant="info">
              These codes replace every previous code. Each can be used once.
            </Alert>
            <RecoveryCodeGrid codes={shownCodes} />
          </>
        )}
        {dialog === "passkey-delete" && (
          <Alert variant="danger">
            Remove {selectedPasskey?.name || "this passkey"}? It will stop
            working immediately.
          </Alert>
        )}
      </Modal>
    </section>
  );
}

function RecoveryCodeGrid({ codes }: { codes: string[] }) {
  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob([`${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "keymint-recovery-codes.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Recovery codes downloaded");
  }

  return (
    <div className="backup-codes-section">
      <div className="backup-codes" aria-label="Recovery codes">
        {codes.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <Button
        className="backup-codes-download"
        icon={<Icon icon={Download01Icon} size={16} />}
        onClick={downloadCodes}
        type="button"
      >
        Download codes
      </Button>
    </div>
  );
}
