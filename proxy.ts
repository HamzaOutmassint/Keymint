import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isRegistrationEnabled } from "@/lib/registration";
import { contentSecurityPolicy } from "@/lib/security-policy";

const protectedPaths = [
  "/dashboard",
  "/categories",
  "/search",
  "/activity",
  "/settings",
];
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let response: NextResponse;
  if (
    request.nextUrl.pathname.startsWith("/register") &&
    !isRegistrationEnabled()
  )
    response = NextResponse.redirect(new URL("/login", request.url));
  else {
    const session = getSessionCookie(request, { cookiePrefix: "keymint" });
    response = protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path)) && !session
      ? NextResponse.redirect(new URL("/login", request.url))
      : NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set("Content-Security-Policy", csp);
  // The matcher covers HTML/RSC navigation, but excludes static assets and
  // APIs. Account and decrypted-vault UI must never be stored by a shared or
  // browser HTTP cache.
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
