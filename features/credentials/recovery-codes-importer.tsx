"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Add01Icon, Cancel01Icon, FileUploadIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Alert, Button, IconButton } from "@/components/ui";
import {
  MAX_RECOVERY_CODE_INPUT_BYTES,
  MAX_RECOVERY_CODE_LENGTH,
  MAX_RECOVERY_CODES,
  normalizeRecoveryCode,
  parseRecoveryCodes,
  recoveryCodeIdentity,
  remainingRecoveryCodes,
} from "@/lib/recovery-codes";
import type { RecoveryCodeSetV1 } from "@/lib/vault-crypto";

type Draft = { key: string; code: string };

let draftKey = 0;
function toDrafts(codes: string[]): Draft[] {
  return codes.map((code) => ({ key: `code-${(draftKey += 1)}`, code }));
}

function isPlainTextFile(file: File) {
  return file.type === "" || file.type.startsWith("text/") || /\.txt$/i.test(file.name);
}

/**
 * Reads a service's recovery-code `.txt` file or pasted text entirely in the
 * browser, detects the codes, and lets the user correct the list before it is
 * applied. Nothing here touches the network; the caller encrypts the result.
 */
export function RecoveryCodesImporter({
  previous,
  onApply,
  onCancel,
  applyLabel = "Use these codes",
  busy = false,
}: {
  previous?: RecoveryCodeSetV1 | null;
  onApply: (codes: string[]) => void | Promise<void>;
  onCancel: () => void;
  applyLabel?: string;
  busy?: boolean;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [overflow, setOverflow] = useState(0);
  const [missed, setMissed] = useState("");
  const [dragging, setDragging] = useState(false);

  function detect(source: string) {
    if (new TextEncoder().encode(source).byteLength > MAX_RECOVERY_CODE_INPUT_BYTES) {
      toast.error("That text is too large to be a recovery-code file");
      return;
    }
    const parsed = parseRecoveryCodes(source);
    setDrafts(toDrafts(parsed.codes));
    setIgnored(parsed.ignored);
    setOverflow(parsed.overflow);
    if (!parsed.codes.length) toast.error("No recovery codes were detected. Add them from the ignored lines below.");
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_RECOVERY_CODE_INPUT_BYTES) {
      toast.error("That file is too large to be a recovery-code file");
      return;
    }
    if (!isPlainTextFile(file)) {
      toast.error("Choose a plain-text (.txt) recovery-code file");
      return;
    }
    try {
      detect(await file.text());
    } catch {
      toast.error("The file could not be read");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function addCode(raw: string) {
    const code = normalizeRecoveryCode(raw);
    if (!code) return false;
    const list = drafts ?? [];
    if (list.length >= MAX_RECOVERY_CODES) {
      toast.error(`A credential can hold up to ${MAX_RECOVERY_CODES} recovery codes`);
      return false;
    }
    if (list.some((item) => recoveryCodeIdentity(item.code) === recoveryCodeIdentity(code))) {
      toast.error("That code is already in the list");
      return false;
    }
    setDrafts([...list, ...toDrafts([code.slice(0, MAX_RECOVERY_CODE_LENGTH)])]);
    return true;
  }

  const codes = (drafts ?? []).map((item) => normalizeRecoveryCode(item.code)).filter(Boolean);
  const duplicate = new Set(codes.map(recoveryCodeIdentity)).size !== codes.length;
  const previousUsed = previous ? previous.codes.length - remainingRecoveryCodes(previous) : 0;

  return (
    <div
      className="recovery-importer"
      // Enter inside these inputs must not submit an enclosing credential form.
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault();
      }}
    >
      {drafts === null ? (
        <>
          <div
            className={`recovery-dropzone ${dragging ? "recovery-dropzone-active" : ""}`.trim()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void readFile(event.dataTransfer.files[0]);
            }}
          >
            <Icon icon={FileUploadIcon} size={22} />
            <span>Drop the recovery-code .txt file here, or</span>
            <Button type="button" onClick={() => fileInput.current?.click()}>
              Choose file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              hidden
              aria-label="Recovery-code text file"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </div>
          <label className="field-label" htmlFor={`${id}-paste`}>
            Or paste the codes
          </label>
          <textarea
            id={`${id}-paste`}
            className="textarea recovery-paste"
            spellCheck={false}
            autoComplete="off"
            placeholder={"abcde-12345\nfghij-67890\n…"}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="recovery-hint">
            The file is read on this device only. Keymint stores the codes inside this credential&apos;s encrypted record.
          </p>
          <div className="recovery-actions">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={!text.trim()} onClick={() => detect(text)}>
              Detect codes
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="recovery-summary" role="status">
            Detected {drafts.length} {drafts.length === 1 ? "code" : "codes"}
            {ignored.length > 0 && ` · ${ignored.length} ${ignored.length === 1 ? "line" : "lines"} ignored`}
          </p>
          {overflow > 0 && (
            <Alert variant="danger">
              {overflow} more {overflow === 1 ? "code was" : "codes were"} left out: a credential can hold up to {MAX_RECOVERY_CODES}.
            </Alert>
          )}
          {previous && previous.codes.length > 0 && (
            <Alert>
              This replaces the {previous.codes.length} codes already saved
              {previousUsed > 0 && ` (${previousUsed} used)`}. Services usually invalidate old codes when they issue new ones. Codes that appear in both lists keep their used state.
            </Alert>
          )}
          {drafts.length > 0 && (
            <ol className="recovery-draft-list" aria-label="Detected recovery codes">
              {drafts.map((item, index) => (
                <li key={item.key}>
                  <input
                    className="input recovery-draft-input"
                    aria-label={`Recovery code ${index + 1}`}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={MAX_RECOVERY_CODE_LENGTH}
                    value={item.code}
                    onChange={(event) =>
                      setDrafts(drafts.map((draft) => (draft.key === item.key ? { ...draft, code: event.target.value } : draft)))
                    }
                  />
                  <IconButton
                    type="button"
                    label={`Remove recovery code ${index + 1}`}
                    onClick={() => setDrafts(drafts.filter((draft) => draft.key !== item.key))}
                  >
                    <Icon icon={Cancel01Icon} size={16} />
                  </IconButton>
                </li>
              ))}
            </ol>
          )}
          {ignored.length > 0 && (
            <details className="recovery-ignored">
              <summary>Show ignored lines</summary>
              <ul>
                {ignored.map((line, index) => (
                  <li key={`${index}-${line}`}>
                    <span>{line}</span>
                    <Button
                      type="button"
                      className="btn-small"
                      onClick={() => {
                        if (addCode(line)) setIgnored(ignored.filter((_, position) => position !== index));
                      }}
                    >
                      Add as code
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="recovery-add-line">
            <input
              className="input"
              aria-label="Add a missed recovery code"
              placeholder="Add a code the detector missed"
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_RECOVERY_CODE_LENGTH}
              value={missed}
              onChange={(event) => setMissed(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && addCode(missed)) setMissed("");
              }}
            />
            <IconButton
              type="button"
              label="Add recovery code"
              disabled={!missed.trim()}
              onClick={() => {
                if (addCode(missed)) setMissed("");
              }}
            >
              <Icon icon={Add01Icon} size={16} />
            </IconButton>
          </div>
          {duplicate && <p className="field-error" role="alert">Remove duplicate codes before continuing.</p>}
          <div className="recovery-actions">
            <Button type="button" onClick={() => setDrafts(null)}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              loadingLabel="Encrypting recovery codes"
              disabled={!codes.length || duplicate}
              onClick={() => void onApply(codes)}
            >
              {applyLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
