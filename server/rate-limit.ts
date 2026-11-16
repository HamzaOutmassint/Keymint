import { prisma } from "@/lib/prisma";

export async function assertRateLimit(
  key: string,
  userId?: string,
  limit = 30,
  windowSeconds = 60,
) {
  const now = Date.now();
  const startMs =
    Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowStart = new Date(startMs);
  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, userId, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (bucket.count > limit)
    throw new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(windowSeconds),
      },
    });
}
