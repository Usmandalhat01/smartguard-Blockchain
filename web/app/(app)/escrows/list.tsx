'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Banknote, Clock, Filter, Gavel, PlusCircle, ShieldCheck, Wallet,
} from 'lucide-react';
import { Button, Card, Empty, Notice, Stat, StatGrid, ui } from '@/components/ui';
import { TransactionTable } from '@/components/escrow';
import { EscrowActions } from '@/components/escrow-actions';
import { useSession } from '@/lib/auth/context';
import { visibleEscrows } from '@/lib/auth/policy';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/clock';
import { duration, eth } from '@/lib/format';
import { ESCROW_STATES, type EscrowState } from '@/lib/types';

type FilterValue = 'all' | EscrowState;

export function EscrowList() {
  const { principal, can } = useSession();
  const { transactions, settings } = useStore();
  const now = useNow();
  const [filter, setFilter] = useState<FilterValue>('all');

  const mine = useMemo(
    () => visibleEscrows(principal, transactions),
    [principal, transactions],
  );

  const shown = filter === 'all' ? mine : mine.filter((t) => t.state === filter);

  const counts = ESCROW_STATES.reduce<Record<string, number>>((acc, state) => {
    acc[state] = mine.filter((t) => t.state === state).length;
    return acc;
  }, {});

  const isSeller = principal.role === 'seller';
  const oversight = can('escrow:read:any');

  const held = mine
    .filter((t) => t.state !== 'COMPLETED')
    .reduce((sum, t) => sum + t.amountEth, 0);

  const settled = mine.filter((t) => t.state === 'COMPLETED');
  const released = settled
    .filter((t) => t.outcome === 'released_to_seller' || t.outcome === 'resolved_for_seller')
    .reduce((sum, t) => sum + t.amountEth, 0);

  const soonestRefund = mine
    .filter((t) => t.state === 'INITIATED')
    .map((t) => Date.parse(t.holdingPeriodEndsAt) - now)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b)[0];

  const title = oversight ? 'All escrows' : isSeller ? 'Orders' : 'Your escrows';
  const lede = oversight
    ? 'Every escrow on the system. Your role grants read access to the complete record so that a case can be reviewed in full.'
    : isSeller
      ? 'Funds a buyer has committed naming your address as seller. You cannot move an escrow yourself — the contract releases to you.'
      : 'Every escrow you have initiated, the risk score that admitted it, and the actions your address is permitted to take.';

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>{title}</h1>
          <p className={ui.pageSub}>{lede}</p>
        </div>
        {can('escrow:create') && (
          <Link href="/escrows/new">
            <Button variant="primary"><PlusCircle size={16} /> New escrow</Button>
          </Link>
        )}
      </div>

      <div className={ui.stack}>
        <StatGrid>
          <Stat
            label={isSeller ? 'Committed to you' : 'Held in contract'}
            value={held.toFixed(2)}
            unit="ETH"
            icon={<Wallet size={13} />}
            tone="chain"
            foot={`${mine.length - settled.length} open · ${mine.length} total`}
          />
          <Stat
            label={isSeller ? 'Released to date' : 'Awaiting delivery'}
            value={isSeller ? released.toFixed(2) : counts.INITIATED ?? 0}
            unit={isSeller ? 'ETH' : undefined}
            icon={isSeller ? <Banknote size={13} /> : <Clock size={13} />}
            tone={isSeller ? 'safe' : 'elevated'}
            foot={isSeller
              ? `${settled.length} completed`
              : soonestRefund ? `Next refund claimable in ${duration(soonestRefund)}` : 'No holding period running'}
          />
          <Stat
            label="In time lock"
            value={counts.DELIVERED ?? 0}
            icon={<ShieldCheck size={13} />}
            tone="brand"
            foot={`${settings.timeLockHours}h dispute window after confirmation`}
          />
          <Stat
            label="Disputed"
            value={counts.DISPUTED ?? 0}
            icon={<Gavel size={13} />}
            tone={(counts.DISPUTED ?? 0) > 0 ? 'blocked' : 'safe'}
            foot="Frozen pending arbitration"
          />
        </StatGrid>

        {(counts.DISPUTED ?? 0) > 0 && !oversight && (
          <Notice tone="warn" title="A dispute is open" icon={<Gavel size={15} />}>
            {eth(mine.filter((t) => t.state === 'DISPUTED').reduce((s, t) => s + t.amountEth, 0))}{' '}
            is with the arbitrator. Neither party can move it until the case is resolved.
          </Notice>
        )}

        <Card
          flush
          title={`${shown.length} escrow${shown.length === 1 ? '' : 's'}`}
          subtitle="Available actions are restricted by the contract to the address entitled to make them."
          actions={
            <label className={ui.row} style={{ gap: 7 }}>
              <Filter size={14} style={{ color: 'var(--text-dim)' }} />
              <span className={ui.srOnly}>Filter by state</span>
              <select
                className={ui.select}
                style={{ width: 'auto', height: 32, padding: '0 32px 0 10px', fontSize: '0.8125rem' }}
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterValue)}
              >
                <option value="all">All states ({mine.length})</option>
                {ESCROW_STATES.map((state) => (
                  <option key={state} value={state}>{state} ({counts[state]})</option>
                ))}
              </select>
            </label>
          }
        >
          <TransactionTable
            transactions={shown}
            threshold={settings.riskThreshold}
            counterpartyLabel={isSeller ? 'Buyer' : 'Seller'}
            counterpartyOf={(t) => (isSeller ? t.buyerId : t.sellerId)}
            actions={(tx) => <EscrowActions tx={tx} />}
            emptyState={
              <Empty
                icon={<Wallet size={19} />}
                title={filter === 'all' ? 'No escrows yet' : 'Nothing in this state'}
                action={can('escrow:create') && filter === 'all' ? (
                  <Link href="/escrows/new">
                    <Button size="sm" variant="primary">Create your first escrow</Button>
                  </Link>
                ) : undefined}
              >
                {filter === 'all'
                  ? 'Escrows naming your address will appear here once they clear the risk gate.'
                  : `No escrow you can see is currently in the ${filter} state.`}
              </Empty>
            }
          />
        </Card>
      </div>
    </>
  );
}
