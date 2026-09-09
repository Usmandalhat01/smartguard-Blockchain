'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Permission, Principal } from './policy';
import { can as policyCan } from './policy';

/**
 * The principal, handed down from the server layout that already verified it.
 *
 * Nothing here is a security boundary — it exists so the interface can avoid
 * rendering controls the server would reject. The value arrives from a server
 * component, never from client storage, so it cannot be edited by the browser
 * to claim a different role.
 */
interface SessionValue {
  principal: Principal;
  can: (permission: Permission) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  principal, children,
}: { principal: Principal; children: ReactNode }) {
  const router = useRouter();

  const can = useCallback(
    (permission: Permission) => policyCan(principal, permission),
    [principal],
  );

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }, [router]);

  return (
    <SessionContext.Provider value={{ principal, can, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
