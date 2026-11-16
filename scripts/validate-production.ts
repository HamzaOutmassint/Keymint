import { validateProductionConfiguration } from "../lib/server-env";

if (process.env.NODE_ENV !== "production") {
  throw new Error("Unsafe production configuration: NODE_ENV must be production");
}

validateProductionConfiguration();
console.log("Production configuration is valid.");
