import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/server/security/password-hashing";

export async function verifyAccountPassword(userId: string, password: string) {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "credential", accountId: userId },
    select: { password: true },
  });
  if (!account?.password) return false;
  return verifyPassword({ password, hash: account.password });
}
