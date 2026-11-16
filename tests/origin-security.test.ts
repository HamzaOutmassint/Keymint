import { describe, expect, it } from "vitest";
import { isCanonicalRequestOrigin } from "@/server/security/origin";

const canonicalOrigin = "https://vault.example.test";

function mutation(url = `${canonicalOrigin}/api/credentials`, origin?: string) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request(url, { method: "POST", headers });
}

describe("canonical mutation origin", () => {
  it("accepts the exact configured origin", () => {
    expect(
      isCanonicalRequestOrigin(
        mutation(undefined, canonicalOrigin),
        canonicalOrigin,
      ),
    ).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["opaque", "null"],
    ["malformed", "not a URL"],
    ["cross-origin", "https://attacker.example"],
    ["same-site subdomain", "https://other.vault.example.test"],
    ["origin containing a path", `${canonicalOrigin}/unexpected`],
  ])("rejects a %s Origin", (_name, origin) => {
    expect(
      isCanonicalRequestOrigin(mutation(undefined, origin), canonicalOrigin),
    ).toBe(false);
  });

  it("rejects cross-site fetch metadata even with the canonical Origin", () => {
    const request = mutation(undefined, canonicalOrigin);
    request.headers.set("sec-fetch-site", "cross-site");
    expect(isCanonicalRequestOrigin(request, canonicalOrigin)).toBe(false);
  });

  it("rejects a forged request Host even with the canonical Origin", () => {
    expect(
      isCanonicalRequestOrigin(
        mutation("https://attacker.example/api/credentials", canonicalOrigin),
        canonicalOrigin,
      ),
    ).toBe(false);
  });

  it("does not require Origin for safe methods", () => {
    expect(
      isCanonicalRequestOrigin(
        new Request(`${canonicalOrigin}/api/credentials`),
        canonicalOrigin,
      ),
    ).toBe(true);
  });
});
