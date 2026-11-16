import { describe, expect, it } from "vitest";
import { assertDemoSeedAllowed } from "@/lib/demo-seed-policy";

describe("demo seed policy", () => {
  it("refuses production even with an acknowledgement", () => {
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: "production",
        ALLOW_DEMO_SEED: "true",
      }),
    ).toThrow("disabled in production");
  });

  it("requires an explicit development acknowledgement", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development" })).toThrow(
      "ALLOW_DEMO_SEED=true",
    );
  });

  it("allows an explicitly acknowledged non-production seed", () => {
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: "development",
        ALLOW_DEMO_SEED: "true",
      }),
    ).not.toThrow();
  });
});
