import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/accounts';
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
