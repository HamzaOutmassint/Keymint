import { prisma } from "@/lib/prisma";
import { handleApiError, requireSession } from "@/server/http";
import { enforceUserActivityRetention } from "@/server/retention";
import { activityPublicSelect } from "@/server/activity";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    await enforceUserActivityRetention(session.user.id);
    const items = await prisma.activityLog.findMany({
      where: { userId: session.user.id },
      select: activityPublicSelect,
      orderBy: { timestamp: "desc" },
      take: 10_000,
    });
    return new Response(JSON.stringify(items, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="keymint-activity-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
