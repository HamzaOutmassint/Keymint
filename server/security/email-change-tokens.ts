import { createHash, randomBytes } from "node:crypto";

export function createEmailChangeToken() {
  return randomBytes(32).toString("base64url");
}

export function hashEmailChangeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
