import { describe, expect, it } from "vitest";
import { searchVault, type VaultSnapshot } from "@/features/vault/data";
import { parseCredentialCsv, serializeCredentialCsv } from "@/features/vault/transfer";
import type { Category, Credential } from "@/types/vault";

const category: Category = {
  id: "cat-local", name: "Finance", color: "#3B82F6", icon: "folder",
  updatedAt: "2026-08-02T12:00:00.000Z", _count: { credentials: 1 },
};
const credential: Credential = {
  id: "cred-local", name: "Bank", username: "alice", email: "alice@example.test",
  website: "https://bank.example.test", password: "=plaintext-password", notes: "tax notes",
  categoryId: category.id, favorite: false, createdAt: "2026-08-02T12:00:00.000Z",
  updatedAt: "2026-08-02T12:00:00.000Z", passwordUpdatedAt: "2026-08-02T12:00:00.000Z",
  lastViewed: null, category,
};
const snapshot: VaultSnapshot = {
  cursor: "1", envelopes: [], payloads: [], categories: [category], credentials: [credential], payloadById: new Map(),
};

describe("local decrypted search", () => {
  it.each(["bank", "alice@example", "tax notes", "finance"])("matches %s without a server query", (query) => {
    expect(searchVault(snapshot, query).credentials.map((item) => item.id)).toEqual(["cred-local"]);
  });
  it("returns no material for a blank query", () => {
    expect(searchVault(snapshot, "  ")).toEqual({ credentials: [], categories: [], recent: [] });
  });
});

describe("local CSV import/export", () => {
  it("round-trips bounded rows and neutralizes spreadsheet formulas", () => {
    const csv = serializeCredentialCsv([credential]);
    expect(csv).not.toContain('"=plaintext-password"');
    expect(csv).toContain('"\'=plaintext-password"');
    expect(parseCredentialCsv(csv)).toEqual([{
      name: "Bank", username: "alice", email: "alice@example.test",
      website: "https://bank.example.test", password: "'=plaintext-password",
      notes: "tax notes", category: "Finance", favorite: "false",
    }]);
  });
  it("rejects non-canonical headers and malformed quoted fields", () => {
    expect(() => parseCredentialCsv("password,name\nsecret,item\n")).toThrow(/header/);
    expect(() => parseCredentialCsv('name,username,email,website,password,notes,category,favorite\n"unterminated')).toThrow(/unterminated/);
  });
});
