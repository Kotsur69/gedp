import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Optimistic gate only: no valid session cookie -> /login. It also re-issues the cookie on
// activity (sliding idle timeout). The real decision (known, active, White Collar employee)
// is made on the server in src/server/current-employee.ts, close to the data.
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set(["/login"]);

export default auth((request) => {
  if (request.auth || PUBLIC_PATHS.has(request.nextUrl.pathname)) return;
  return NextResponse.redirect(new URL("/login", request.nextUrl));
});

export const config = {
  // Skip Auth.js endpoints, build assets and public static files (public/brand is shown on /login,
  // before sign-in). `api/auth(?:/|$)` so an unrelated route such as /api/authorize-x is still gated.
  matcher: ["/((?!api/auth(?:/|$)|_next/static|_next/image|brand/|favicon.ico).*)"],
};
