// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialRow } from "@/features/credentials/credential-row";
import { CredentialFormModal } from "@/features/credentials/credential-form-modal";
import type { VaultSnapshot } from "@/features/vault/data";
import type { CredentialValueV1 } from "@/lib/vault-crypto";
import type { Credential } from "@/types/vault";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as VaultSnapshot | undefined, isPending: false, isError: false, isFetching: false },
  saveCredential: vi.fn(),
  updateCredential: vi.fn(),
  touchCredential: vi.fn(),
  copySensitiveText: vi.fn(),
  logClientActivity: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/vault/data", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/vault/data")>(),
  useVaultData: () => mocks.query,
  useVaultMutations: () => ({
    saveCredential: mocks.saveCredential,
    updateCredential: mocks.updateCredential,
    touchCredential: mocks.touchCredential,
  }),
}));
vi.mock("@/features/security/clipboard", () => ({ copySensitiveText: mocks.copySensitiveText }));
vi.mock("@/features/activity/log-client", () => ({ logClientActivity: mocks.logClientActivity }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

const AT = "2026-11-17T12:00:00.000Z";
const recoveryCodes = {
  codes: [{ code: "a1b2c-3d4e5", usedAt: null }, { code: "f6a7b-8c9d0", usedAt: AT }],
  updatedAt: AT,
};
const credential: Credential = {
  id: "github", name: "GitHub", username: "alice", password: "private-password", favorite: false,
  categoryId: null, createdAt: AT, updatedAt: AT, passwordUpdatedAt: AT, lastViewed: null, recoveryCodes,
};
const storedValue: CredentialValueV1 = {
  categoryId: null, email: "", favorite: false, lastViewedAt: null, name: "GitHub", notes: "",
  password: "private-password", passwordUpdatedAt: AT, username: "alice", website: "", recoveryCodes,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copySensitiveText.mockResolvedValue(undefined);
  mocks.logClientActivity.mockResolvedValue(undefined);
  mocks.saveCredential.mockResolvedValue(undefined);
  mocks.updateCredential.mockResolvedValue(undefined);
  mocks.query = {
    data: { cursor: "1", envelopes: [], payloads: [], categories: [], credentials: [credential], payloadById: new Map() },
    isPending: false, isError: false, isFetching: false,
  };
});

afterEach(cleanup);

describe("credential recovery codes", () => {
  it("shows remaining codes and keeps them when the credential is favorited", async () => {
    render(<CredentialRow credential={credential} />);
    expect(screen.getByText("1/2 codes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalledWith(
      expect.objectContaining({ favorite: true, recoveryCodes }),
      credential.id,
    ));
  });

  it("verifies before listing codes, then copies and marks them from the latest record", async () => {
    render(<CredentialRow credential={credential} />);
    expect(screen.queryByText("a1b2c-3d4e5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show GitHub recovery codes" }));
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect(within(list).getByText("a1b2c-3d4e5")).toBeVisible();
    expect(screen.getByText("1 of 2 codes remaining")).toBeVisible();
    expect(mocks.logClientActivity).toHaveBeenCalledWith("RECOVERY_CODES_VIEWED");

    fireEvent.click(screen.getByRole("button", { name: "Copy recovery code 1" }));
    await waitFor(() => expect(mocks.copySensitiveText).toHaveBeenCalledWith("a1b2c-3d4e5"));
    await waitFor(() => expect(mocks.logClientActivity).toHaveBeenCalledWith("RECOVERY_CODE_COPIED"));

    fireEvent.click(screen.getByRole("button", { name: "Mark used" }));
    await waitFor(() => expect(mocks.updateCredential).toHaveBeenCalledWith(credential.id, expect.any(Function)));
    const update = mocks.updateCredential.mock.calls[0][1] as (value: CredentialValueV1) => CredentialValueV1;
    const next = update(storedValue);
    expect(next.recoveryCodes?.codes.map((item) => item.usedAt !== null)).toEqual([true, true]);
    expect(next.password).toBe("private-password");
  });

  it("imports pasted codes with an editable preview when adding a credential", async () => {
    render(<CredentialFormModal open onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Discord" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "another-secret" } });

    fireEvent.click(screen.getByRole("button", { name: "Add codes" }));
    fireEvent.change(screen.getByLabelText("Or paste the codes"), {
      target: { value: "Discord backup codes\n\n* k9x2-m4p7\n* q3w8-e5r1\n* zz11-yy22\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Detect codes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Detected 3 codes · 1 line ignored");

    fireEvent.change(screen.getByLabelText("Recovery code 3"), { target: { value: "zz11-yy99" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove recovery code 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Use these codes" }));
    expect(screen.getByText(/2 codes saved · 2 unused/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalledTimes(1));
    const [value, id] = mocks.saveCredential.mock.calls[0] as [CredentialValueV1, string | undefined];
    expect(id).toBeUndefined();
    expect(value.name).toBe("Discord");
    expect(value.recoveryCodes?.codes).toEqual([
      { code: "k9x2-m4p7", usedAt: null },
      { code: "zz11-yy99", usedAt: null },
    ]);
  });

  it("omits the field entirely when codes are removed in the form", async () => {
    render(<CredentialFormModal open onClose={() => undefined} edit={credential} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalledTimes(1));
    const [value] = mocks.saveCredential.mock.calls[0] as [CredentialValueV1];
    expect("recoveryCodes" in value).toBe(false);
  });
});
