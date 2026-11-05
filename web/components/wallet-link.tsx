'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { useSession } from '@/lib/auth/context';
import { useStore } from '@/lib/store';
import { linkWallet } from '@/lib/live-store';
import { connect, signLinkMessage } from '@/lib/wallet';

/**
 * Binds the signed-in account to a wallet the person controls.
 *
 * Contract roles are wallet addresses, so an account needs a real one before it
 * can deposit or receive funds. The wallet signs a fixed challenge; the service
 * checks the signature recovers to the address claimed. The session cookie
 * carries the old address, so the person signs in again to pick up the new one.
 */
export function WalletLink({ className }: { className?: string }) {
  const { principal, signOut } = useSession();
  const { onChain, contracts } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!onChain) return null;

  async function link() {
    setBusy(true); setMsg(null);
    try {
      const account = await connect(contracts.chainId);
      const signature = await signLinkMessage(account, `SmartGuard wallet link for account ${principal.userId}`);
      await linkWallet(account, signature);
      setMsg('Wallet linked. Signing you out so the new address takes effect.');
      setTimeout(() => void signOut(), 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not link the wallet.');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '4px 12px' }}>
      <button className={className} onClick={link} disabled={busy}>
        <Link2 size={16} /> {busy ? 'Waiting for wallet…' : 'Link my wallet'}
      </button>
      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 4 }}>
        Linked: {principal.walletAddress.slice(0, 8)}…{principal.walletAddress.slice(-4)}
      </div>
      {msg && <div role="status" style={{ fontSize: '0.75rem', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
