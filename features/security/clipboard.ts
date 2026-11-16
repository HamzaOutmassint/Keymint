type ClipboardAccess = Pick<Clipboard, "readText" | "writeText">;

export async function copySensitiveText(
  value: string,
  clearAfterMs = 30_000,
  clipboard: ClipboardAccess = navigator.clipboard,
) {
  await clipboard.writeText(value);
  setTimeout(() => {
    void (async () => {
      try {
        // Do not erase newer clipboard content. Browser permission policy may
        // reject readText outside a user gesture, so cleanup is best effort.
        if ((await clipboard.readText()) === value) {
          await clipboard.writeText("");
        }
      } catch {
        // The browser or operating system remains the clipboard authority.
      }
    })();
  }, clearAfterMs);
}
