import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { AuditLog } from './log';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage() {
  await requirePermission('admin:audit:read');
  return <AuditLog />;
}
