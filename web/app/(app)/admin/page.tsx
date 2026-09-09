import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { SystemOverview } from './overview';

export const metadata: Metadata = { title: 'System overview' };

export default async function AdminPage() {
  await requirePermission('admin:settings:read');
  return <SystemOverview />;
}
