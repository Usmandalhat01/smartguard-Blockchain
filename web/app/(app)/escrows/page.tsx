import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/server';
import { EscrowList } from './list';

export const metadata: Metadata = { title: 'Escrows' };

/**
 * Scoping happens twice on purpose. The list component filters through
 * `visibleEscrows`, and in deployment `GET /api/v1/escrows` applies the same
 * predicate server-side — a client that asked for someone else's escrow would
 * receive nothing regardless of what it rendered.
 */
export default async function EscrowsPage() {
  await requirePrincipal('/escrows');
  return <EscrowList />;
}
