import { describe, expect, it } from "vitest";
import {
  neutralizeSpreadsheetCell,
  neutralizeSpreadsheetRecord,
} from "@/server/security/csv";

describe("CSV spreadsheet safety", () => {
  it.each([
    "=WEBSERVICE(\"https://example.test\")",
    "+1+1",
    "-2+3",
    "@SUM(1,2)",
    "  =1+1",
    "\t=1+1",
    "\rvalue",
    "\nvalue",
  ])("neutralizes a dangerous cell prefix: %j", (value) => {
    expect(neutralizeSpreadsheetCell(value)).toBe(`'${value}`);
  });

  it.each(["normal", "https://example.test", " leading text", "0", ""])(
    "preserves a benign value: %j",
    (value) => {
      expect(neutralizeSpreadsheetCell(value)).toBe(value);
    },
  );

  it("neutralizes every string field without changing non-string fields", () => {
    expect(
      neutralizeSpreadsheetRecord({
        name: "=1+1",
        password: "+secret",
        favorite: true,
      }),
    ).toEqual({ name: "'=1+1", password: "'+secret", favorite: true });
  });
});
