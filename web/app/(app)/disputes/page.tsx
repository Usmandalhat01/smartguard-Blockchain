import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { DisputeQueue } from './queue';

export const metadata: Metadata = { title: 'Dispute queue' };

/**
 * `dispute:read:any` is held by the arbitrator and the administrator. Only the
 * arbitrator additionally holds `dispute:resolve`, so an administrator reaching
 * this page sees the cases but no ruling controls — which is exactly what the
 * contract would enforce, since resolveDispute is restricted to the escrow's
 * designated arbitrator address.
 */
export default async function DisputesPage() {
  await requirePermission('dispute:read:any');
  return <DisputeQueue />;
}
