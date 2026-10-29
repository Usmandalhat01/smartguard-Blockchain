'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { USER_BY_ID } from '@/lib/seed';
import { eth, relativeTime } from '@/lib/format';
import { ESCROW_STATE_META, riskBand, type Outcome, type Transaction } from '@/lib/types';
import { Badge, ui, type Tone } from './ui';

const OUTCOME_LABEL: Record<Outcome, string> = {
  released_to_seller: 'Released to seller',
  refunded_to_buyer: 'Refunded to buyer',
  resolved_for_seller: 'Arbitrated → seller',
  resolved_for_buyer: 'Arbitrated → buyer',
  timeout_refund: 'Timeout refund',
};

export function StateBadge({ tx }: { tx: Transaction }) {
  const meta = ESCROW_STATE_META[tx.state];
  const label = tx.state === 'COMPLETED' && tx.outcome ? OUTCOME_LABEL[tx.outcome] : meta.label;
  return <Badge tone={meta.tone as Tone} dot>{label}</Badge>;
}

export function RiskBadge({ tx, threshold }: { tx: Transaction; threshold: number }) {
  const band = riskBand(tx.prediction.riskScore, threshold);
  return (
    <Badge tone={band.tone as Tone}>
      <span className="tnum">{tx.prediction.riskScore.toFixed(2)}</span>
      <span style={{ opacity: 0.75, fontWeight: 500 }}>{band.label}</span>
    </Badge>
  );
}

/**
 * One table used by all three party views. Each caller supplies the actions
 * appropriate to its role, because the permitted transitions differ by
 * address — the same restriction the contract enforces at the EVM level.
 */
export function TransactionTable({
  transactions, threshold, counterpartyLabel = 'Seller', counterpartyOf = (t) => t.sellerId,
  actions, emptyState,
}: {
  transactions: Transaction[];
  threshold: number;
  counterpartyLabel?: string;
  counterpartyOf?: (tx: Transaction) => string;
  actions?: (tx: Transaction) => ReactNode;
  emptyState?: ReactNode;
}) {
  if (transactions.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th>Escrow</th>
            <th>{counterpartyLabel}</th>
            <th className={ui.tdRight}>Amount</th>
            <th>Risk score</th>
            <th>State</th>
            <th>Updated</th>
            {actions && <th className={`${ui.tdRight} ${ui.tdSticky}`}>Action</th>}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const other = USER_BY_ID[counterpartyOf(tx)];
            const updated = tx.completedAt ?? tx.deliveryConfirmedAt ?? tx.createdAt;
            return (
              <tr key={tx.id}>
                <td>
                  <Link
                    href={`/dashboard/escrow/${tx.id}`}
                    className="mono"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 550 }}
                  >
                    {tx.id}
                    <ArrowUpRight size={12} />
                  </Link>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.itemDescription}
                  </div>
                </td>
                <td>{other?.displayName ?? '—'}</td>
                <td className={`${ui.tdRight} tnum`} style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {eth(tx.amountEth)}
                </td>
                <td><RiskBadge tx={tx} threshold={threshold} /></td>
                <td><StateBadge tx={tx} /></td>
                <td style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {relativeTime(updated)}
                </td>
                {actions && <td className={`${ui.tdRight} ${ui.tdSticky}`}>{actions(tx)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
