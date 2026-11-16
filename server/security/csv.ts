const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;
const LEADING_CONTROL = /^[\t\r\n]/;

/**
 * CSV has no portable non-executable cell type. Prefix values that common
 * spreadsheet applications can interpret as formulas with a literal marker.
 */
export function neutralizeSpreadsheetCell(value: string) {
  return FORMULA_PREFIX.test(value) || LEADING_CONTROL.test(value)
    ? `'${value}`
    : value;
}

export function neutralizeSpreadsheetRecord<T extends Record<string, unknown>>(
  record: T,
) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? neutralizeSpreadsheetCell(value) : value,
    ]),
  );
}
