import { describe, expect, it } from "vitest";
import { generatePassword, passwordEntropy } from "@/features/credentials/password-generator";

describe("password generator", () => {
  const options = { length: 32, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeAmbiguous: true };
  it("uses the requested length and every enabled character class", () => { const value = generatePassword(options); expect(value).toHaveLength(32); expect(value).toMatch(/[A-Z]/); expect(value).toMatch(/[a-z]/); expect(value).toMatch(/[0-9]/); expect(value).toMatch(/[^A-Za-z0-9]/); expect(value).not.toMatch(/[Il1O0o]/); });
  it("calculates useful entropy", () => expect(passwordEntropy(options)).toBeGreaterThan(180));
});
