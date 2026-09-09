import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/server';
import { homeFor } from '@/lib/auth/policy';

/** No shared dashboard: each role lands in the workspace it is authorised for. */
export default async function DashboardRedirect() {
  const principal = await requirePrincipal();
  redirect(homeFor(principal.role));
}
