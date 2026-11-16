/** Next.js invokes this once when a server instance starts. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { validateProductionConfiguration } = await import("./lib/server-env");
    validateProductionConfiguration();
  }
}
