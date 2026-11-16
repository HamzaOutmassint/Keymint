import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSensitiveClientState } from "@/features/security/clear-sensitive-client-state";
import { copySensitiveText } from "@/features/security/clipboard";
import { useVaultStore } from "@/features/vault/store";

describe("sensitive client state", () => {
  afterEach(() => {
    vi.useRealTimers();
    useVaultStore.getState().lock();
  });

  it("clears query data and in-memory vault authorization", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["credentials"], [{ notes: "sensitive" }]);
    useVaultStore.getState().setGrant("vault-grant", 900);
    useVaultStore.getState().setCreateOpen(true);

    await clearSensitiveClientState(queryClient);

    expect(queryClient.getQueryData(["credentials"])).toBeUndefined();
    expect(useVaultStore.getState()).toMatchObject({
      grant: null,
      expiresAt: null,
      createOpen: false,
    });
  });

  it("clears a copied secret only when the clipboard still contains it", async () => {
    vi.useFakeTimers();
    let clipboardValue = "";
    const clipboard = {
      readText: vi.fn(async () => clipboardValue),
      writeText: vi.fn(async (value: string) => {
        clipboardValue = value;
      }),
    };

    await copySensitiveText("secret", 30_000, clipboard);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(clipboard.writeText).toHaveBeenNthCalledWith(1, "secret");
    expect(clipboard.writeText).toHaveBeenNthCalledWith(2, "");
  });

  it("does not erase clipboard content copied later", async () => {
    vi.useFakeTimers();
    let clipboardValue = "";
    const clipboard = {
      readText: vi.fn(async () => clipboardValue),
      writeText: vi.fn(async (value: string) => {
        clipboardValue = value;
      }),
    };

    await copySensitiveText("secret", 30_000, clipboard);
    clipboardValue = "new clipboard value";
    await vi.advanceTimersByTimeAsync(30_000);

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboardValue).toBe("new clipboard value");
  });
});
