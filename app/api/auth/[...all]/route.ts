import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handlers = toNextJsHandler(auth);

function preventSensitiveResponseCaching(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, max-age=0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Parameters<typeof handlers.GET>[0]) {
  return preventSensitiveResponseCaching(await handlers.GET(request));
}

export async function POST(request: Parameters<typeof handlers.POST>[0]) {
  return preventSensitiveResponseCaching(await handlers.POST(request));
}
