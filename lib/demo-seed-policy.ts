type Environment = Record<string, string | undefined>;

export function assertDemoSeedAllowed(
  environment: Environment = process.env,
) {
  if (environment.NODE_ENV === "production") {
    throw new Error("Demo seed is disabled in production");
  }
  if (environment.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Set ALLOW_DEMO_SEED=true to acknowledge development-only demo data",
    );
  }
}
