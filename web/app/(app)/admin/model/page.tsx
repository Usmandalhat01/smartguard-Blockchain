import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth/server';
import { ModelCard } from './card';

export const metadata: Metadata = { title: 'Model & features' };

export default async function ModelPage() {
  await requirePermission('admin:model:read');
  return <ModelCard />;
}
