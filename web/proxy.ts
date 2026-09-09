/**
 * Route admission.
 *
 * Runs before every matched request and performs an *optimistic* check: it
 * verifies the session cookie's signature and compares the principal's role
 * against the route table in lib/auth/policy. It exists to keep unauthorised
 * navigation from rendering at all.
 *
 * It is not the authorisation boundary. Next.js documentation is explicit that
 * the proxy should not be treated as full session management, so every
 * protected page and route handler repeats the check server-side against the
 * same policy module.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { can, homeFor, permissionForRoute } from '@/lib/auth/policy';

/** Reachable without a session. */
const PUBLIC_PATHS = ['/', '/login', '/forbidden'];

/** Everything under these prefixes requires a session. */
const PROTECTED_PREFIXES = ['/escrows', '/disputes', '/admin', '/dashboard'];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const principal = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // Anonymous request for a protected route → sign in, then come back.
  if (isProtected && !principal) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Already signed in and asking for the login page → go to the role's home.
  if (principal && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(principal.role);
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Signed in but the role does not hold the permission this route requires.
  if (principal && isProtected && !isPublic) {
    const required = permissionForRoute(pathname);
    if (required && !can(principal, required)) {
      const url = request.nextUrl.clone();
      url.pathname = '/forbidden';
      url.search = `?permission=${encodeURIComponent(required)}&to=${encodeURIComponent(homeFor(principal.role))}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and image optimisation; run on everything else.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
