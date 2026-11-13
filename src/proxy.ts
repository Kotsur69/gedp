import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { LOCALE_COOKIE, localizedPath } from "@/i18n/config";

// 1) Optimistic gate only: no valid session cookie -> /login. It also re-issues the cookie on
//    activity (sliding idle timeout). The real decision (known, active, White Collar employee)
//    is made on the server in src/server/current-employee.ts, close to the data.
// 2) Language: every page request is rewritten to the internal /[locale] segment picked from the
//    locale cookie (Polish by default). The visible URL never changes.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set(["/login"]);

export default auth((request) => {
  const { pathname } = request.nextUrl;
  if (!request.auth && !PUBLIC_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  // API routes and files are still gated above, just not localized.
  const localized = localizedPath(pathname, request.cookies.get(LOCALE_COOKIE)?.value);
  if (localized === null) return;
  const target = request.nextUrl.clone();
  target.pathname = localized;
  return NextResponse.rewrite(target);
});

export const config = {
  // Skip Auth.js endpoints, build assets and public static files (public/brand is shown on /login,
  // before sign-in). `api/auth(?:/|$)` so an unrelated route such as /api/authorize-x is still gated.
  // Every exclusion is anchored, so "/favicon.icoX" or "/_next/staticX" are still gated.
  matcher: ["/((?!api/auth(?:/|$)|_next/(?:static|image)(?:/|$)|brand/|favicon\\.ico$).*)"],
};
