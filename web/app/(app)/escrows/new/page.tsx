import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { NewEscrowForm } from './form';

export const metadata: Metadata = { title: 'New escrow' };

/**
 * `escrow:create` is held only by the buyer role. The proxy rejects the
 * navigation and this check rejects the render, so reaching the page by typing
 * the address gets the same answer as clicking a link that is not there.
 */
export default async function NewEscrowPage() {
  await requirePermission('escrow:create');
  return <NewEscrowForm />;
}
