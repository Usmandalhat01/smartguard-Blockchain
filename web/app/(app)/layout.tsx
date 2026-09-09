import { requirePrincipal } from '@/lib/auth/server';
import { SessionProvider } from '@/lib/auth/context';
import { AppShell } from '@/components/app-shell';

/**
 * Every route in this group is authenticated. The session is verified here on
 * the server — the proxy's earlier check was optimistic — and the principal is
 * handed to the client tree as data it cannot modify.
 */
export default async function AuthenticatedLayout({
  children,
}: { children: React.ReactNode }) {
  const principal = await requirePrincipal();

  return (
    <SessionProvider principal={principal}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
