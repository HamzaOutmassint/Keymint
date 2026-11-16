// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { CredentialRow } from "@/features/credentials/credential-row";
import { useVaultStore } from "@/features/vault/store";
import type { VaultSnapshot } from "@/features/vault/data";
import type { Credential } from "@/types/vault";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as VaultSnapshot | undefined, isPending: false, isError: false },
  saveCredential: vi.fn(),
  touchCredential: vi.fn(),
  copySensitiveText: vi.fn(),
  logClientActivity: vi.fn(),
  toastError: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/features/vault/data", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/vault/data")>(),
  useVaultData: () => mocks.query,
  useVaultMutations: () => ({ saveCredential: mocks.saveCredential, touchCredential: mocks.touchCredential }),
}));
vi.mock("@/features/security/clipboard", () => ({ copySensitiveText: mocks.copySensitiveText }));
vi.mock("@/features/activity/log-client", () => ({ logClientActivity: mocks.logClientActivity }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/features/vault/unlock-gate", () => ({ VaultUnlockGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/features/credentials/credential-form-modal", () => ({ CredentialFormModal: () => null }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

const credential: Credential = {
  id: "bank", name: "Bank", username: "alice@example.test", website: "https://bank.example.test",
  password: "private-password", favorite: false, categoryId: null,
  createdAt: "2026-10-16T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z",
  passwordUpdatedAt: "2026-10-16T10:00:00.000Z", lastViewed: null,
};

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell user={{ name: "Alice", email: "alice@example.test" }}><p>Dashboard content</p></AppShell>
    </QueryClientProvider>,
  );
}

function openSearch() {
  const trigger = screen.getByRole("button", { name: "Search passwords" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copySensitiveText.mockResolvedValue(undefined);
  mocks.logClientActivity.mockResolvedValue(undefined);
  mocks.touchCredential.mockResolvedValue(undefined);
  mocks.saveCredential.mockResolvedValue(undefined);
  mocks.query = {
    data: { cursor: "1", envelopes: [], payloads: [], categories: [], credentials: [{ ...credential }], payloadById: new Map() },
    isPending: false, isError: false,
  };
  useVaultStore.getState().setUnlocked(true);
});

afterEach(() => {
  cleanup();
  useVaultStore.getState().lock();
});

describe("header password search", () => {
  it("focuses search and lets users reveal, hide, copy, and favorite a matching password", async () => {
    renderShell();
    const trigger = openSearch();
    const search = screen.getByRole("searchbox", { name: "Search saved passwords" });
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByText("Find a saved password")).toBeVisible();
    fireEvent.change(search, { target: { value: " ALICE@EXAMPLE " } });
    const dialog = screen.getByRole("dialog", { name: "Search passwords" });
    expect(within(dialog).getByText("Bank")).toBeVisible();
    expect(screen.queryByText(credential.password)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Bank" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reveal Bank password" }));
    await waitFor(() => expect(screen.getByText(credential.password)).toBeVisible());
    expect(mocks.logClientActivity).toHaveBeenCalledWith("PASSWORD_VIEWED");
    fireEvent.click(screen.getByRole("button", { name: "Hide Bank password" }));
    expect(screen.queryByText(credential.password)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Bank password" }));
    await waitFor(() => expect(mocks.copySensitiveText).toHaveBeenCalledWith(credential.password));
    await waitFor(() => expect(mocks.logClientActivity).toHaveBeenCalledWith("PASSWORD_COPIED"));
    expect(mocks.touchCredential).toHaveBeenCalledWith(credential);
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    await waitFor(() => expect(mocks.saveCredential).toHaveBeenCalledWith(expect.objectContaining({ favorite: true, password: credential.password }), credential.id));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    openSearch();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.queryByText(credential.password)).not.toBeInTheDocument();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("opens with the keyboard shortcut %j and dismisses immediately on lock", async (modifier) => {
    renderShell();
    fireEvent.keyDown(window, { key: "k", ...modifier });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal Bank password" }));
    await waitFor(() => expect(screen.getByText(credential.password)).toBeVisible());

    act(() => useVaultStore.getState().lock());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(credential.password)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search passwords" })).toBeDisabled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("handles no matches, loading, and failure states", () => {
    const { rerender } = render(<AppShell user={{ name: "Alice", email: "alice@example.test" }}>Dashboard</AppShell>, {
      wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>,
    });
    openSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No matching passwords")).toBeVisible();

    mocks.query = { data: undefined, isPending: true, isError: false };
    rerender(<AppShell user={{ name: "Alice", email: "alice@example.test" }}>Dashboard</AppShell>);
    expect(screen.getByRole("status", { name: "Loading passwords" })).toBeVisible();
    mocks.query = { data: undefined, isPending: false, isError: true };
    rerender(<AppShell user={{ name: "Alice", email: "alice@example.test" }}>Dashboard</AppShell>);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to search your vault");
  });

  it("keeps search open when copying fails and reports the failure", async () => {
    mocks.copySensitiveText.mockRejectedValueOnce(new Error("Clipboard denied"));
    renderShell();
    openSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy Bank password" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Clipboard denied"));
    expect(screen.getByRole("dialog", { name: "Search passwords" })).toBeVisible();
    expect(mocks.logClientActivity).not.toHaveBeenCalled();
  });

  it("preserves the existing confirmation flow for normal credential rows", async () => {
    render(<CredentialRow credential={credential} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal Bank password" }));
    expect(screen.getByRole("dialog", { name: "Verify your identity" })).toBeVisible();
    expect(screen.queryByText(credential.password)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Password revealed" })).toBeVisible());
    expect(screen.getByText(credential.password)).toBeVisible();
  });

  it("does not stack search over another open dialog", () => {
    renderShell();
    const { unmount } = render(<CredentialRow credential={credential} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal Bank password" }));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search passwords" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Verify your identity" })).toBeVisible();
    unmount();
  });
});
