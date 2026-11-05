import { NextResponse } from 'next/server';
import { getApiToken } from '@/lib/auth/server';
import { BACKEND_URL } from '@/lib/backend-url';

/**
 * Same-origin proxy to the FastAPI service.
 *
 * The browser calls /api/backend/<path>; this handler adds the bearer token
 * held in the session cookie and forwards the request. Authorisation is still
 * decided by FastAPI (policy.py): this layer only carries credentials, so a
 * request without a session is refused here and a request without permission is
 * refused there.
 */
async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!BACKEND_URL) {
    return NextResponse.json({ error: 'No backend is configured.' }, { status: 503 });
  }
  const token = await getApiToken();
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { path } = await ctx.params;
  const url = new URL(request.url);
  const target = `${BACKEND_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${url.search}`;

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { 'Content-Type': request.headers.get('content-type') ?? 'application/json' } : {}),
      },
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'The application service is unreachable.' }, { status: 503 });
  }

  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
