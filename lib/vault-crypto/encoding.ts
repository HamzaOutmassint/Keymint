import canonicalize from "canonicalize";

import type { JsonValue } from "./types";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REVISION_PATTERN = /^[1-9][0-9]{0,19}$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const UINT64_MAX = 18446744073709551615n;

/** Returns whether a string contains an unpaired UTF-16 surrogate. */
export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Encodes a valid Unicode string to UTF-8 and rejects lone surrogates. */
export function encodeUtf8(value: string): Uint8Array {
  if (hasUnpairedSurrogate(value)) {
    throw new TypeError("Text contains an unpaired Unicode surrogate");
  }
  return new TextEncoder().encode(value);
}

/** Decodes UTF-8 bytes without replacement and rejects invalid byte sequences. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Recursively validates that a value is finite, surrogate-free JSON data. */
export function assertJsonValue(
  value: unknown,
  depth = 0,
): asserts value is JsonValue {
  if (depth > 32) throw new TypeError("JSON nesting exceeds 32 levels");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      throw new TypeError("JSON contains an unpaired Unicode surrogate");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON number must be finite");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON objects must be plain objects");
    }
    for (const [key, item] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) {
        throw new TypeError("JSON key contains an unpaired Unicode surrogate");
      }
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  throw new TypeError("Value is not valid JSON");
}

/** Serializes a JSON value using RFC 8785 JSON Canonicalization Scheme. */
export function canonicalizeJson(value: JsonValue): string {
  assertJsonValue(value);
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new TypeError("Value cannot be canonicalized");
  return serialized;
}

/** Scans JSON grammar and rejects duplicate keys at every object depth. */
function assertNoDuplicateJsonKeys(text: string): void {
  let index = 0;

  /** Advances past JSON whitespace. */
  function skipWhitespace(): void {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  }

  /** Parses one JSON string token and returns its decoded key value. */
  function parseString(): string {
    const start = index;
    if (text[index] !== '"') throw new TypeError("JSON string is malformed");
    index += 1;
    while (index < text.length) {
      const character = text[index];
      const code = text.charCodeAt(index);
      if (character === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index)) as string;
      }
      if (character === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) {
            throw new TypeError("JSON Unicode escape is malformed");
          }
          index += 5;
        } else if (escape && '"\\/bfnrt'.includes(escape)) {
          index += 1;
        } else {
          throw new TypeError("JSON escape is malformed");
        }
      } else {
        if (code <= 0x1f) throw new TypeError("JSON string contains a control character");
        index += 1;
      }
    }
    throw new TypeError("JSON string is unterminated");
  }

  /** Parses one JSON array and recursively scans its values. */
  function parseArray(depth: number): void {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      parseValue(depth + 1);
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") throw new TypeError("JSON array is malformed");
      index += 1;
      skipWhitespace();
    }
  }

  /** Parses one JSON object while detecting repeated decoded property names. */
  function parseObject(depth: number): void {
    const keys = new Set<string>();
    index += 1;
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (true) {
      const key = parseString();
      if (keys.has(key)) throw new TypeError("JSON contains duplicate object keys");
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") throw new TypeError("JSON object is malformed");
      index += 1;
      parseValue(depth + 1);
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") throw new TypeError("JSON object is malformed");
      index += 1;
      skipWhitespace();
    }
  }

  /** Parses one JSON value without constructing a second plaintext object graph. */
  function parseValue(depth: number): void {
    if (depth > 32) throw new TypeError("JSON nesting exceeds 32 levels");
    skipWhitespace();
    const character = text[index];
    if (character === "{") return parseObject(depth);
    if (character === "[") return parseArray(depth);
    if (character === '"') {
      parseString();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) throw new TypeError("JSON value is malformed");
    index += number[0].length;
  }

  skipWhitespace();
  parseValue(0);
  skipWhitespace();
  if (index !== text.length) throw new TypeError("JSON has trailing non-whitespace data");
}

/** Strictly parses UTF-8 JSON, rejecting duplicate keys, invalid Unicode, and trailing data. */
export function parseStrictJson(bytes: Uint8Array, maximumBytes: number): JsonValue {
  if (bytes.byteLength > maximumBytes) throw new RangeError("JSON input is too large");
  const text = decodeUtf8(bytes);
  if (text.charCodeAt(0) === 0xfeff) throw new TypeError("JSON must not contain a BOM");
  try {
    assertNoDuplicateJsonKeys(text);
    const parsed: unknown = JSON.parse(text);
    assertJsonValue(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new TypeError("JSON is malformed");
  }
}

/** Parses canonical UTF-8 JCS bytes and rejects alternate JSON representations. */
export function parseCanonicalJson(bytes: Uint8Array, maximumBytes: number): JsonValue {
  if (bytes.byteLength > maximumBytes) throw new RangeError("JSON input is too large");
  const text = decodeUtf8(bytes);
  const parsed = parseStrictJson(bytes, maximumBytes);
  if (canonicalizeJson(parsed) !== text) throw new TypeError("JSON is not canonical");
  return parsed;
}

/** Encodes bytes as unpadded RFC 4648 Base64url without Node APIs. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Strictly decodes canonical unpadded RFC 4648 Base64url text. */
export function decodeBase64Url(value: string, maximumBytes = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError("Base64url value is not canonical");
  }
  if (Math.floor((value.length * 6) / 8) > maximumBytes) {
    throw new RangeError("Decoded value is too large");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new TypeError("Base64url value is invalid");
  }
  if (binary.length > maximumBytes) throw new RangeError("Decoded value is too large");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    bytes.fill(0);
    throw new TypeError("Base64url value has non-zero unused bits");
  }
  return bytes;
}

/** Encodes bytes as uppercase unpadded RFC 4648 Base32. */
export function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
    accumulator &= (1 << bitCount) - 1;
  }
  if (bitCount > 0) output += BASE32_ALPHABET[(accumulator << (5 - bitCount)) & 31];
  return output;
}

/** Strictly decodes uppercase unpadded RFC 4648 Base32. */
export function decodeBase32(value: string): Uint8Array {
  if (!/^[A-Z2-7]*$/.test(value)) throw new TypeError("Base32 value is invalid");
  const output = new Uint8Array(Math.floor((value.length * 5) / 8));
  let accumulator = 0;
  let bitCount = 0;
  let offset = 0;
  for (const character of value) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      output[offset] = (accumulator >>> (bitCount - 8)) & 0xff;
      offset += 1;
      bitCount -= 8;
    }
    accumulator &= (1 << bitCount) - 1;
  }
  if (accumulator !== 0 || encodeBase32(output) !== value) {
    output.fill(0);
    throw new TypeError("Base32 value has non-zero unused bits");
  }
  return output;
}

/** Validates a protocol identifier containing only safe ASCII characters. */
export function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${field} is not a valid protocol identifier`);
  }
}

/** Validates a lowercase canonical UUIDv4 string. */
export function assertUuidV4(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase UUIDv4`);
  }
}

/** Validates a positive decimal revision that fits an unsigned 64-bit integer. */
export function assertRevision(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !REVISION_PATTERN.test(value) ||
    BigInt(value) > UINT64_MAX
  ) {
    throw new TypeError(`${field} must be a positive unsigned 64-bit decimal string`);
  }
}

/** Validates a positive integer that fits the protocol's four-byte key version. */
export function assertKeyVersion(value: unknown, field = "keyVersion"): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 0xffffffff) {
    throw new TypeError(`${field} must be a positive 32-bit integer`);
  }
}

/** Validates an exact UTC RFC 3339 timestamp with millisecond precision. */
export function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) {
    throw new TypeError(`${field} must be an RFC 3339 millisecond UTC timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TypeError(`${field} is not a real calendar timestamp`);
  }
}

/** Requires a plain object's keys to exactly match a strict protocol schema. */
export function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${field} contains missing or unknown fields`);
  }
}
