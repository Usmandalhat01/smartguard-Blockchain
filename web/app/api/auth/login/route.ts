import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/accounts';
import { BACKEND_URL } from '@/lib/backend-url';
import { homeFor } from '@/lib/auth/policy';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions, signSession } from '@/lib/auth/session';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * Establishes a session. Stands in for `POST /api/v1/auth/login` on the FastAPI
 * service — when that exists this handler forwards the credentials and re-signs
 * the returned claims into the same HttpOnly cookie, so nothing downstream
 * changes.
 */
export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email address and password are required.' }, { status: 400 });
  }

  // Live mode: the FastAPI service is the credential store. Its token is kept
  // inside the signed HttpOnly cookie and attached by /api/backend, so the
  // browser never holds it.
  if (BACKEND_URL) {
    let upstream: Response;
    try {
      upstream = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      });
    } catch {
      return NextResponse.json({ error: 'The application service is unreachable.' }, { status: 503 });
    }
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Those credentials were not recognised.' }, { status: upstream.status === 401 ? 401 : 502 });
    }
    const login = await upstream.json() as { accessToken: string; expiresIn: number; principal: Parameters<typeof signSession>[0]; redirectTo: string };
    const token = await signSession(login.principal, login.accessToken);
    const response = NextResponse.json({ principal: login.principal, redirectTo: homeFor(login.principal.role) });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(Math.min(SESSION_TTL_SECONDS, login.expiresIn)));
    return response;
  }

  const result = await authenticate(email, password);
  if (!result.ok) {
    // One message for both failure modes, so the response does not confirm
    // whether an account exists.
    return NextResponse.json({ error: 'Those credentials were not recognised.' }, { status: 401 });
  }

  const token = await signSession(result.principal);
  const response = NextResponse.json({
    principal: result.principal,
    redirectTo: homeFor(result.principal.role),
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
  return response;
}
