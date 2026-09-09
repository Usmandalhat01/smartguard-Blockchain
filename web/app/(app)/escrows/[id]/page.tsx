import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/server';
import { EscrowDetail } from './detail';

export const metadata: Metadata = { title: 'Escrow' };

/**
 * Read access is decided per object, not per route: a party sees its own
 * escrow, an arbitrator and an administrator see any. The check lives in the
 * client component because the record itself is client-held until the FastAPI
 * service exists — at which point `GET /api/v1/escrows/{id}` performs it
 * server-side and returns 404 rather than 403, so the response does not confirm
 * that an escrow with that id exists.
 */
export default async function EscrowDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePrincipal(`/escrows/${id}`);
  return <EscrowDetail id={id} />;
}
