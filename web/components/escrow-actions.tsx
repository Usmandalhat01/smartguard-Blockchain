'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, CheckCircle2, Gavel, Timer, Undo2 } from 'lucide-react';
import { Button } from './ui';
import { DisputeDialog } from './dispute-dialog';
import { useSession } from '@/lib/auth/context';
import {
  canClaimRefund, canConfirmDelivery, canRaiseDispute, canWithdraw, disputeRoleOf,
} from '@/lib/auth/policy';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/clock';
import { duration } from '@/lib/format';
import type { Transaction } from '@/lib/types';

/**
 * The actions available on one escrow, decided by the policy module rather than
 * by the role name. Every branch here corresponds to a modifier on
 * EscrowContract, so a control appears only when the contract would accept the
 * call from this address in this state.
 */
export function EscrowActions({ tx }: { tx: Transaction }) {
  const { principal } = useSession();
  const { settings, confirmDelivery, claimRefund, releaseAfterTimeLock } = useStore();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    // Stands in for the round trip to the oracle bridge and block confirmation.
    await new Promise((r) => setTimeout(r, 700));
    await fn();
    setBusy(false);
  }

  const mayConfirm = canConfirmDelivery(principal, tx);
  const mayRefund = canClaimRefund(principal, tx, now);
  const mayWithdraw = canWithdraw(principal, tx, settings.timeLockHours, now);
  const mayDispute = canRaiseDispute(principal, tx);
  const disputeRole = disputeRoleOf(principal, tx);

  const controls: React.ReactNode[] = [];

  if (mayConfirm) {
    controls.push(
      <Button key="confirm" size="sm" variant="primary" loading={busy}
        onClick={() => run(() => confirmDelivery(tx.id))}>
        <CheckCircle2 size={13} /> Confirm receipt
      </Button>,
    );
  }

  if (mayRefund) {
    controls.push(
      <Button key="refund" size="sm" variant="danger" loading={busy}
        onClick={() => run(() => claimRefund(tx.id))}>
        <Undo2 size={13} /> Claim refund
      </Button>,
    );
  }

  if (mayWithdraw) {
    controls.push(
      <Button key="withdraw" size="sm" variant="success" loading={busy}
        onClick={() => run(() => releaseAfterTimeLock(tx.id))}>
        <Banknote size={13} /> Withdraw
      </Button>,
    );
  }

  if (mayDispute && disputeRole) {
    controls.push(
      <Button key="dispute" size="sm" variant="danger" onClick={() => setDisputeOpen(true)}>
        <Gavel size={13} /> Dispute
      </Button>,
    );
  }

  // Nothing to do yet — say what is being waited on rather than showing an
  // empty cell.
  if (controls.length === 0) {
    const waiting = waitingLabel(tx, principal.userId, settings.timeLockHours, now);
    return waiting ? (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: '0.8125rem', color: 'var(--text-dim)', whiteSpace: 'nowrap',
      }}>
        <Timer size={13} /> {waiting}
      </span>
    ) : (
      <Link href={`/escrows/${tx.id}`}>
        <Button size="sm" variant="ghost">View</Button>
      </Link>
    );
  }

  return (
    <>
      <span style={{ display: 'inline-flex', gap: 6 }}>{controls}</span>
      {disputeOpen && disputeRole && (
        <DisputeDialog tx={tx} role={disputeRole} onClose={() => setDisputeOpen(false)} />
      )}
    </>
  );
}

function waitingLabel(
  tx: Transaction, userId: string, timeLockHours: number, now: number,
): string | null {
  if (tx.state === 'DISPUTED') return 'With the arbitrator';

  if (tx.state === 'INITIATED' && tx.sellerId === userId) {
    return 'Awaiting buyer confirmation';
  }

  if (tx.state === 'DELIVERED' && tx.deliveryConfirmedAt && now > 0) {
    const remaining = Date.parse(tx.deliveryConfirmedAt) + timeLockHours * 3_600_000 - now;
    if (remaining > 0) return `Time lock: ${duration(remaining)}`;
  }

  return null;
}
