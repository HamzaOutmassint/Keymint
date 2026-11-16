import { MAX_IMPORT_RECORDS } from "@/lib/import-policy";
import type { Credential } from "@/types/vault";

const HEADERS = ["name", "username", "email", "website", "password", "notes", "category", "favorite"] as const;
export type CsvCredential = Record<(typeof HEADERS)[number], string>;

function safeCell(value: string) {
  const protectedValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

/** Creates an explicitly plaintext, spreadsheet-formula-safe CSV entirely in the browser. */
export function serializeCredentialCsv(credentials: Credential[]): string {
  const lines = [HEADERS.join(",")];
  for (const item of credentials) {
    lines.push([
      item.name, item.username, item.email ?? "", item.website ?? "", item.password,
      item.notes ?? "", item.category?.name ?? "", String(item.favorite),
    ].map(safeCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"' && value === "") quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") {
      row.push(value.replace(/\r$/, "")); value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else value += character;
  }
  if (quoted) throw new TypeError("CSV contains an unterminated quoted field");
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

/** Parses a bounded, exact-header CSV without involving the server. */
export function parseCredentialCsv(source: string): CsvCredential[] {
  const rows = parseRows(source.replace(/^\uFEFF/, ""));
  if (!rows.length || rows[0].length !== HEADERS.length || rows[0].some((cell, index) => cell !== HEADERS[index])) {
    throw new TypeError(`CSV header must be exactly: ${HEADERS.join(",")}`);
  }
  if (rows.length - 1 > MAX_IMPORT_RECORDS) throw new RangeError(`CSV contains more than ${MAX_IMPORT_RECORDS} credentials`);
  return rows.slice(1).map((row, rowIndex) => {
    if (row.length !== HEADERS.length) throw new TypeError(`CSV row ${rowIndex + 2} has the wrong number of fields`);
    return Object.fromEntries(HEADERS.map((header, index) => [header, row[index]])) as CsvCredential;
  });
}

export function downloadLocalFile(contents: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
