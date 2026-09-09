/**
 * Server-side access to the current principal.
 *
 * Every server component and route handler that touches protected data reads
 * the session through here. The proxy's check is optimistic — it only inspects
 * the cookie to keep navigation snappy — so these functions are where
 * authorisation is actually decided.
 */

import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from './session';
import { can, homeFor, type Permission, type Principal } from './policy';

export async function getPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** Requires a signed-in principal; sends anonymous visitors to the login page. */
export async function requirePrincipal(returnTo?: string): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return principal;
}

/**
 * Requires a specific permission. A signed-in user without it is shown the
 * forbidden page rather than the login page — they are authenticated, just not
 * authorised, and conflating the two sends people round a login loop.
 */
export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!can(principal, permission)) {
    redirect(`/forbidden?permission=${encodeURIComponent(permission)}&to=${encodeURIComponent(homeFor(principal.role))}`);
  }
  return principal;
}
