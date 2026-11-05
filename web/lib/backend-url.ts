/**
 * Where the FastAPI service lives, as seen from the Next.js server.
 *
 * `API_URL` is read only on the server. `NEXT_PUBLIC_API_URL` is accepted as a
 * fallback so the one setting in the repository `.env` still works, but note it
 * is also what tells the browser that live mode is on; the browser never calls
 * this address directly, it calls /api/backend on its own origin.
 */
export const BACKEND_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
