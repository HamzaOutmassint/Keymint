// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Modal } from "@/components/ui";

afterEach(cleanup);

describe("UI behavior in jsdom", () => {
  it("keeps keyboard focus inside a modal and restores focus when it closes", async () => {
    const onClose = vi.fn();
    const content = (open: boolean) => (
      <>
        <Button>Open settings</Button>
        <Modal open={open} title="Settings" onClose={onClose} footer={<Button>Save</Button>}>
          <input aria-label="Name" />
        </Modal>
      </>
    );
    const { rerender } = render(content(false));
    const trigger = screen.getByRole("button", { name: "Open settings" });
    const previousOverflow = document.body.style.overflow;
    trigger.focus();
    rerender(content(true));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    const close = screen.getByRole("button", { name: "Close dialog" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(content(false));
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe(previousOverflow);
  });

  it("prevents closing a modal while a secure operation is loading", () => {
    const onClose = vi.fn();
    render(<Modal open loading title="Saving" onClose={onClose}>Saving changes</Modal>);

    expect(screen.getByRole("dialog", { name: "Saving" })).toHaveAttribute("aria-busy", "true");
    const close = screen.getByRole("button", { name: "Close dialog" });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
