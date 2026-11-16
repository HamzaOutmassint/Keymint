import { describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { GET as health, HEAD as healthHead } from "@/app/api/health/route";
import { GET as ready, HEAD as readyHead } from "@/app/api/ready/route";
import { securityHeaders } from "@/lib/security-headers";
import { checkReadiness } from "@/server/readiness";
import { readFileSync } from "node:fs";

describe("production readiness", () => {
  it("provides dependency-free, cache-disabled liveness responses", async () => {
    const response = health();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(healthHead().body).toBeNull();
  });

  it("reports readiness only when the dependency check succeeds", async () => {
    await expect(checkReadiness(async () => 1, 100)).resolves.toBe(true);
    await expect(
      checkReadiness(async () => {
        throw new Error("database unavailable");
      }, 100),
    ).resolves.toBe(false);
  });

  it("maps database readiness to generic 200 and 503 responses", async () => {
    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
    const available = await ready();
    expect(available.status).toBe(200);
    await expect(available.json()).resolves.toEqual({ status: "ready" });

    queryRaw.mockRejectedValueOnce(new Error("do not expose this database error"));
    const unavailable = await ready();
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ status: "unavailable" });

    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);
    expect((await readyHead()).body).toBeNull();
  });

  it("bounds readiness checks with a timeout", async () => {
    vi.useFakeTimers();
    const result = checkReadiness(() => new Promise(() => undefined), 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("adds HSTS only to production and applies browser hardening globally", () => {
    const production = securityHeaders(true);
    const development = securityHeaders(false);
    expect(production).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
    expect(development.some(({ key }) => key === "Strict-Transport-Security")).toBe(false);
    expect(production).toContainEqual({
      key: "X-Permitted-Cross-Domain-Policies",
      value: "none",
    });
    expect(production.find(({ key }) => key === "Permissions-Policy")?.value)
      .toContain("publickey-credentials-get=(self)");
  });

  it("validates production configuration during server startup", () => {
    expect(readFileSync("instrumentation.ts", "utf8")).toContain(
      "validateProductionConfiguration();",
    );
  });
});
