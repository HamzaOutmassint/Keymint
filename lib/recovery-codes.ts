import {
  MAX_RECOVERY_CODE_LENGTH,
  MAX_RECOVERY_CODES,
  recoveryCodeIdentity,
} from "./vault-crypto/records";
import type { CredentialValueV1, RecoveryCodeSetV1 } from "./vault-crypto/types";

export { MAX_RECOVERY_CODE_LENGTH, MAX_RECOVERY_CODES, recoveryCodeIdentity };

/** Largest recovery-code text file or paste Keymint will read. Real files are well under 2 KB. */
export const MAX_RECOVERY_CODE_INPUT_BYTES = 64 * 1024;

export type ParsedRecoveryCodes = {
  /** Detected codes in file order, normalized and de-duplicated. */
  codes: string[];
  /** Non-empty fragments that did not look like codes (headers, instructions, dates). */
  ignored: string[];
  /** Codes dropped because the file held more than MAX_RECOVERY_CODES. */
  overflow: number;
};

const LIST_MARKER = /^(?:\d{1,3}[.)]\s+|[-*•·]\s+|\[\s*[xX]?\s*\]\s*)/;
const CODE_SHAPE = /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/;

/** Trims and collapses inner whitespace so the stored code matches what the user sees. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Heuristic for "this fragment is a recovery code, not prose". Deliberately
 * conservative: anything rejected is shown to the user as an ignored line that
 * can be added back with one click.
 */
export function isLikelyRecoveryCode(candidate: string): boolean {
  if (candidate.length < 6 || candidate.length > 64 || !CODE_SHAPE.test(candidate)) return false;
  const groups = candidate.split(/[ -]/);
  if (groups.length > 8 || groups.some((group) => group.length < 3)) return false;
  const hasDigit = /\d/.test(candidate);
  if (groups.length === 1) return hasDigit;
  // Hyphen-joined tokens such as "abcd-12345" or Microsoft-style five-group codes.
  if (!candidate.includes(" ") && hasDigit) return true;
  const sameLength = groups.every((group) => group.length === groups[0].length);
  if (sameLength) return hasDigit || candidate.includes("-");
  return groups.every((group) => /\d/.test(group));
}

/**
 * Extracts recovery codes from the text of a service's recovery-code file or a
 * paste. Handles one code per line, numbered or bulleted lists, and multi-column
 * layouts separated by tabs or runs of spaces. Runs entirely in the browser.
 */
export function parseRecoveryCodes(text: string): ParsedRecoveryCodes {
  const codes: string[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  let overflow = 0;
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const fragment of trimmed.split(/\t+| {2,}/)) {
      const raw = fragment.trim();
      if (!raw) continue;
      const candidate = normalizeRecoveryCode(raw.replace(LIST_MARKER, ""));
      if (!isLikelyRecoveryCode(candidate)) {
        ignored.push(raw);
        continue;
      }
      const identity = recoveryCodeIdentity(candidate);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (codes.length >= MAX_RECOVERY_CODES) overflow += 1;
      else codes.push(candidate);
    }
  }
  return { codes, ignored, overflow };
}

/** Returns a copy of `value` with the recovery codes set, or with the key removed for `null`. */
export function withRecoveryCodes(
  value: CredentialValueV1,
  set: RecoveryCodeSetV1 | null | undefined,
): CredentialValueV1 {
  const { recoveryCodes: _previous, ...rest } = value;
  void _previous;
  return set && set.codes.length ? { ...rest, recoveryCodes: set } : rest;
}

/**
 * Builds a new code set from an edited list. Codes that already existed keep
 * their used state, so re-importing the same file does not reset progress.
 */
export function buildRecoveryCodeSet(
  codes: string[],
  previous: RecoveryCodeSetV1 | null | undefined,
  now: string,
): RecoveryCodeSetV1 | null {
  const usedAt = new Map(previous?.codes.map((item) => [recoveryCodeIdentity(item.code), item.usedAt]) ?? []);
  const seen = new Set<string>();
  const next: RecoveryCodeSetV1["codes"] = [];
  for (const raw of codes) {
    const code = normalizeRecoveryCode(raw);
    const identity = recoveryCodeIdentity(code);
    if (!code || seen.has(identity)) continue;
    seen.add(identity);
    next.push({ code, usedAt: usedAt.get(identity) ?? null });
  }
  return next.length ? { codes: next, updatedAt: now } : null;
}

/** Marks one code used (`usedAt` timestamp) or unused (`null`). */
export function setRecoveryCodeUsed(
  set: RecoveryCodeSetV1,
  code: string,
  usedAt: string | null,
  now: string,
): RecoveryCodeSetV1 {
  return {
    codes: set.codes.map((item) => (item.code === code ? { ...item, usedAt } : item)),
    updatedAt: now,
  };
}

export function remainingRecoveryCodes(set: RecoveryCodeSetV1 | null | undefined): number {
  return set?.codes.filter((item) => item.usedAt === null).length ?? 0;
}

/** True when the user should generate fresh codes soon: 2 or fewer left, or 20% or less. */
export function isRecoveryCodeSetLow(set: RecoveryCodeSetV1 | null | undefined): boolean {
  if (!set?.codes.length) return false;
  const remaining = remainingRecoveryCodes(set);
  return remaining <= 2 || remaining / set.codes.length <= 0.2;
}

/** Plain-text export of the unused codes, one per line. */
export function formatRecoveryCodesTxt(credentialName: string, set: RecoveryCodeSetV1): string {
  const unused = set.codes.filter((item) => item.usedAt === null).map((item) => item.code);
  return [`${credentialName} recovery codes`, "", ...unused, ""].join("\n");
}

/** Safe download filename derived from the credential name. */
export function recoveryCodesFilename(credentialName: string): string {
  const slug = credentialName.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "credential"}-recovery-codes.txt`;
}
