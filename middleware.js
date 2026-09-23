import { NextResponse } from "next/server";

/**
 * This sends a signed-out visitor to the login screen. That is ALL it does,
 * and the two things it no longer does are both deliberate.
 *
 * IT NO LONGER DECIDES WHO MAY READ THE API. The version this replaces waved
 * a request through whenever an `x-bot-key` header was merely PRESENT:
 *
 *     if (pathname.startsWith("/api/") && req.headers.get("x-bot-key"))
 *       return NextResponse.next();
 *
 * The comment beside it said the key was "checked in the route itself", which
 * was true of the POST routes and false of the GET routes. So
 * `curl /api/items -H "x-bot-key: anything"` returned up to 400 items —
 * customer names, money figures, drafted replies, who approved what — to
 * anyone on the internet who sent that header with any value in it at all.
 *
 * Every route now authenticates its own caller (callerFrom in lib/auth), and
 * so does the board page. That is also what the Next.js docs advise:
 * middleware runs at a network boundary that a refactor can quietly move a
 * route out of, which makes it the wrong place to keep the only gate.
 *
 * IT NO LONGER VERIFIES THE SIGNATURE. Middleware runs on the Edge runtime by
 * default, where `node:crypto` does not exist — so the old import of
 * readSession() from lib/auth would have failed at build or at run, taking
 * sign-in down with it. This version of Next can put middleware on the Node
 * runtime behind a config flag, but doing that would only move real
 * verification back into the one place that should not carry it. Whether a
 * cookie is PRESENT is enough to decide whether to show a login screen;
 * whether it is GENUINE is decided where the data is, by code that can do the
 * arithmetic.
 *
 * The cookie name is repeated here rather than imported because importing
 * lib/auth is what dragged node:crypto into the Edge bundle. If it ever
 * changes, it changes in both places — lib/auth.js says so too.
 */
const COOKIE_NAME = "squatch_session";

export function middleware(req) {
  const { pathname } = req.nextUrl;

  // The login screen, the API (every route checks its own caller) and Next's
  // own assets.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (req.cookies.get(COOKIE_NAME)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
