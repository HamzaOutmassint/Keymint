import argon2 from "argon2";

export const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

export async function hashPassword(password: string) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword({
  password,
  hash,
}: {
  password: string;
  hash: string;
}) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
