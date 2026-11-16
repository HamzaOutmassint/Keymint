import { prisma } from "@/lib/prisma";
import { handleApiError, ok, requireSession } from "@/server/http";
import { enforceUserActivityRetention } from "@/server/retention";
import { activityPublicSelect } from "@/server/activity";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    await enforceUserActivityRetention(session.user.id);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.slice(0, 200);
    const requestedPage = Number(url.searchParams.get("page") ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1
      ? Math.min(requestedPage, 10_000)
      : 1;
    const where = {
      userId: session.user.id,
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { browser: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.activityLog.findMany({
        where,
        select: activityPublicSelect,
        orderBy: { timestamp: "desc" },
        take: 25,
        skip: (page - 1) * 25,
      }),
      prisma.activityLog.count({ where }),
    ]);
    return ok({ items, total, page, pages: Math.ceil(total / 25) });
  } catch (error) {
    return handleApiError(error);
  }
}
