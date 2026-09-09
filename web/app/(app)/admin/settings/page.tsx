import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { RiskSettings } from './settings';

export const metadata: Metadata = { title: 'Risk configuration' };

/** Writing configuration is a distinct grant from reading it. */
export default async function SettingsPage() {
  await requirePermission('admin:settings:write');
  return <RiskSettings />;
}
