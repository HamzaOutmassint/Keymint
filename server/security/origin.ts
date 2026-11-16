const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCanonicalRequestOrigin(
  request: Request,
  canonicalOrigin: string,
) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin || suppliedOrigin === "null") return false;

  try {
    const expected = new URL(canonicalOrigin).origin;
    const parsedOrigin = new URL(suppliedOrigin);
    const requestOrigin = new URL(request.url).origin;
    return (
      suppliedOrigin === parsedOrigin.origin &&
      parsedOrigin.origin === expected &&
      requestOrigin === expected
    );
  } catch {
    return false;
  }
}
