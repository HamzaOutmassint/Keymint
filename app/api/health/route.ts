const headers = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json({ status: "ok" }, { status: 200, headers });
}

export function HEAD() {
  return new Response(null, { status: 200, headers });
}
