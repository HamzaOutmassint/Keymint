import { describe, expect, it } from "vitest";

import {
  buildRecoveryCodeSet,
  formatRecoveryCodesTxt,
  isLikelyRecoveryCode,
  isRecoveryCodeSetLow,
  MAX_RECOVERY_CODES,
  parseRecoveryCodes,
  recoveryCodesFilename,
  remainingRecoveryCodes,
  setRecoveryCodeUsed,
  withRecoveryCodes,
} from "@/lib/recovery-codes";
import type { CredentialValueV1, RecoveryCodeSetV1 } from "@/lib/vault-crypto";

const NOW = "2026-11-17T12:00:00.000Z";
const LATER = "2026-11-18T12:00:00.000Z";

const GITHUB_STYLE = `a1b2c-3d4e5
f6a7b-8c9d0
1e2f3-a4b5c
`;

const GOOGLE_STYLE = `﻿BACKUP VERIFICATION CODES
alice@example.test

1. 1234 5678     6. 2345 6789
2. 3456 7890     7. 4567 8901
3. 5678 9012     8. 6789 0123

Keep these backup codes somewhere safe but accessible.
Generated on 2026-11-17
* You can only use each backup code once.`;

describe("parseRecoveryCodes", () => {
  it("reads one hyphenated code per line", () => {
    expect(parseRecoveryCodes(GITHUB_STYLE)).toEqual({
      codes: ["a1b2c-3d4e5", "f6a7b-8c9d0", "1e2f3-a4b5c"],
      ignored: [],
      overflow: 0,
    });
  });

  it("reads numbered two-column layouts and ignores headers, dates and instructions", () => {
    const parsed = parseRecoveryCodes(GOOGLE_STYLE);
    expect(parsed.codes).toEqual([
      "1234 5678", "2345 6789", "3456 7890", "4567 8901", "5678 9012", "6789 0123",
    ]);
    expect(parsed.ignored).toEqual([
      "BACKUP VERIFICATION CODES",
      "alice@example.test",
      "Keep these backup codes somewhere safe but accessible.",
      "Generated on 2026-11-17",
      "* You can only use each backup code once.",
    ]);
  });

  it("handles CRLF, tabs, bullets, checkboxes and long multi-group codes", () => {
    const parsed = parseRecoveryCodes(
      "- k9x2m4p7\r\n• q3w8e5r1\r\n[ ] zz11yy22\tAAAAA-BBBBB-CCCCC-DDDDD-EEEEE\r\n",
    );
    expect(parsed.codes).toEqual(["k9x2m4p7", "q3w8e5r1", "zz11yy22", "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"]);
  });

  it("drops duplicates regardless of case and spacing", () => {
    expect(parseRecoveryCodes("abcd 1234\nABCD  1234\nabcd1234\n").codes).toEqual(["abcd 1234"]);
  });

  it(`keeps at most ${MAX_RECOVERY_CODES} codes and reports the overflow`, () => {
    const text = Array.from({ length: MAX_RECOVERY_CODES + 3 }, (_, index) => `code-${String(index).padStart(5, "0")}`).join("\n");
    const parsed = parseRecoveryCodes(text);
    expect(parsed.codes).toHaveLength(MAX_RECOVERY_CODES);
    expect(parsed.overflow).toBe(3);
  });

  it("returns nothing for empty or prose-only input", () => {
    expect(parseRecoveryCodes("")).toEqual({ codes: [], ignored: [], overflow: 0 });
    expect(parseRecoveryCodes("Your recovery codes\nKeep this safe").codes).toEqual([]);
  });

  it("rejects prose-shaped fragments", () => {
    for (const text of ["Generated", "Codes 1-10", "Keep this safe", "sign-in", "12:30 PM", "https://x.test", "2026-11-17"]) {
      expect(isLikelyRecoveryCode(text)).toBe(false);
    }
  });
});

describe("recovery code set helpers", () => {
  const base: CredentialValueV1 = {
    categoryId: null, email: "", favorite: false, lastViewedAt: null, name: "GitHub", notes: "",
    password: "secret", passwordUpdatedAt: NOW, username: "alice", website: "",
  };

  it("adds and removes the optional field without leaving undefined behind", () => {
    const set = buildRecoveryCodeSet(["a1b2c-3d4e5"], null, NOW) as RecoveryCodeSetV1;
    const withCodes = withRecoveryCodes(base, set);
    expect(withCodes.recoveryCodes).toEqual(set);
    const without = withRecoveryCodes(withCodes, null);
    expect("recoveryCodes" in without).toBe(false);
    expect(without).toEqual(base);
  });

  it("keeps used state for codes that survive a re-import", () => {
    const first = buildRecoveryCodeSet(["aaaa-1111", "bbbb-2222"], null, NOW) as RecoveryCodeSetV1;
    const used = setRecoveryCodeUsed(first, "aaaa-1111", NOW, NOW);
    const next = buildRecoveryCodeSet(["AAAA-1111", "cccc-3333"], used, LATER) as RecoveryCodeSetV1;
    expect(next).toEqual({
      codes: [{ code: "AAAA-1111", usedAt: NOW }, { code: "cccc-3333", usedAt: null }],
      updatedAt: LATER,
    });
    expect(buildRecoveryCodeSet(["  "], used, LATER)).toBeNull();
  });

  it("counts remaining codes and flags low sets", () => {
    let set = buildRecoveryCodeSet(Array.from({ length: 10 }, (_, i) => `code-${i}000`), null, NOW) as RecoveryCodeSetV1;
    expect(remainingRecoveryCodes(set)).toBe(10);
    expect(isRecoveryCodeSetLow(set)).toBe(false);
    for (let i = 0; i < 8; i += 1) set = setRecoveryCodeUsed(set, `code-${i}000`, NOW, NOW);
    expect(remainingRecoveryCodes(set)).toBe(2);
    expect(isRecoveryCodeSetLow(set)).toBe(true);
    expect(isRecoveryCodeSetLow(null)).toBe(false);
  });

  it("exports unused codes only, with a safe filename", () => {
    const set = setRecoveryCodeUsed(
      buildRecoveryCodeSet(["aaaa-1111", "bbbb-2222"], null, NOW) as RecoveryCodeSetV1,
      "aaaa-1111", NOW, NOW,
    );
    const text = formatRecoveryCodesTxt("GitHub", set);
    expect(text).toBe("GitHub recovery codes\n\nbbbb-2222\n");
    expect(parseRecoveryCodes(text).codes).toEqual(["bbbb-2222"]);
    expect(recoveryCodesFilename("My GitHub / Work")).toBe("my-github-work-recovery-codes.txt");
    expect(recoveryCodesFilename("***")).toBe("credential-recovery-codes.txt");
  });
});
