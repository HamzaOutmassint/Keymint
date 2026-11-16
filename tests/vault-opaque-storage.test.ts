import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("opaque persistence boundary", () => {
  it("keeps semantic credential fields out of VaultRecord storage", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const block = schema.match(/model VaultRecord \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(block).not.toMatch(/\b(name|username|email|website|notes|favorite|categoryId|password)\b/);
    expect(block).toMatch(/ciphertext\s+String/);
    expect(block).toMatch(/syncSequence\s+Int/);
  });

  it("does not send V2 search terms or backup files to an API", () => {
    const search = readFileSync("app/(vault)/search/page.tsx", "utf8");
    const settings = readFileSync("app/(vault)/settings/page.tsx", "utf8");
    expect(search).not.toMatch(/\/api\/search/);
    expect(settings).not.toMatch(/\/api\/vault\/(?:import|export)/);
  });
});
