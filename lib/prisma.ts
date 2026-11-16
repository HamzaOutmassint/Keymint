import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = resolveServerSecurityEnvironment().databaseUrl;
const adapter = new PrismaPg({ connectionString });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
