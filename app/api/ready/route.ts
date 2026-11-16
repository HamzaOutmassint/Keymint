import { prisma } from "@/lib/prisma";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";
import { checkReadiness } from "@/server/readiness";

const headers = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readinessResponse(includeBody: boolean) {
  const { readinessTimeoutMs } = resolveServerSecurityEnvironment();
  const ready = await checkReadiness(
    () => prisma.$queryRaw`SELECT 1`,
    readinessTimeoutMs,
  );
  const status = ready ? 200 : 503;
  if (!includeBody) return new Response(null, { status, headers });
  return Response.json(
    { status: ready ? "ready" : "unavailable" },
    { status, headers },
  );
}

export function GET() {
  return readinessResponse(true);
}

export function HEAD() {
  return readinessResponse(false);
}
