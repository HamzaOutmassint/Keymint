import { ZodError, type ZodType } from "zod";
import { auth } from "@/lib/auth";
import { resolveServerSecurityEnvironment } from "@/lib/server-env";
import { isCanonicalRequestOrigin } from "@/server/security/origin";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "Authentication required");
  return session;
}

/** Requires an account session issued during the protocol's five-minute window. */
export function assertFreshAccountAuthentication(
  session: { session?: { createdAt?: Date | string } },
  now = Date.now(),
): void {
  const createdAt = session.session?.createdAt;
  const issuedAt = createdAt instanceof Date
    ? createdAt.getTime()
    : typeof createdAt === "string"
      ? Date.parse(createdAt)
      : Number.NaN;
  if (!Number.isFinite(issuedAt) || issuedAt > now || now - issuedAt > 5 * 60_000) {
    throw new ApiError(
      403,
      "Sign in again before changing vault recovery keys",
    );
  }
}

export function assertSameOrigin(request: Request) {
  const canonicalOrigin = resolveServerSecurityEnvironment().appUrl;
  if (!isCanonicalRequestOrigin(request, canonicalOrigin))
    throw new ApiError(403, "Invalid request origin");
}

export function assertVaultProtocolV2(request: Request) {
  if (request.headers.get("Keymint-Vault-Protocol") !== "2") {
    throw new ApiError(426, "Vault Protocol 2 is required");
  }
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = 1_000_000,
): Promise<T> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0)
      throw new ApiError(400, "Invalid Content-Length");
    if (length > maxBytes)
      throw new ApiError(413, "Request body is too large");
  }
  try {
    if (!request.body) throw new SyntaxError("Missing body");
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let json = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "Request body is too large");
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return schema.parse(JSON.parse(json));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof ZodError)
      throw new ApiError(400, "Validation failed", error.flatten());
    throw new ApiError(400, "Invalid JSON body");
  }
}

export function ok(data: unknown, init: ResponseInit = {}) {
  return Response.json(
    { data },
    { ...init, headers: { "cache-control": "no-store", ...init.headers } },
  );
}

export function handleApiError(error: unknown) {
  if (error instanceof Response) {
    const headers = new Headers(error.headers);
    headers.set("cache-control", "no-store");
    return new Response(error.body, {
      status: error.status,
      statusText: error.statusText,
      headers,
    });
  }
  if (error instanceof ApiError)
    return Response.json(
      { error: error.message, details: error.details },
      { status: error.status, headers: { "cache-control": "no-store" } },
    );
  const errorId = crypto.randomUUID();
  // Keep credentials, request bodies, SQL, provider responses, and stack traces
  // out of stdout. Operators can correlate the opaque ID with request metrics.
  console.error(JSON.stringify({
    event: "api-request-failed",
    errorId,
    errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
  }));
  return Response.json(
    { error: "An unexpected error occurred", errorId },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}
