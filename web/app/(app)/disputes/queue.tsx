'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Eye, Gavel, MessageSquareWarning, Scale, ShieldCheck, Timer } from 'lucide-react';
import { Address, Badge, Button, Card, Empty, Notice, Stat, StatGrid, ui } from '@/components/ui';
import { RiskDial } from '@/components/domain';
import { ResolveDialog } from '@/components/resolve-dialog';
import { useSession } from '@/lib/auth/context';
import { canResolveDispute } from '@/lib/auth/policy';
import { useStore } from '@/lib/store';
import { SELLER_PROFILES, USER_BY_ID } from '@/lib/seed';
import { absoluteTime, eth, pct, relativeTime } from '@/lib/format';
import type { Dispute, Transaction } from '@/lib/types';
import q from './queue.module.css';

export function DisputeQueue() {
  const { principal, can } = useSession();
  const { disputes, transactions, settings } = useStore();
  const [active, setActive] = useState<{ tx: Transaction; dispute: Dispute } | null>(null);

  const open = disputes.filter((d) => !d.resolvedAt);
  const closed = disputes.filter((d) => d.resolvedAt);
  const mayResolveAny = can('dispute:resolve');

  const frozen = transactions
    .filter((t) => t.state === 'DISPUTED')
    .reduce((sum, t) => sum + t.amountEth, 0);

  const forSeller = closed.filter((d) => d.resolutionForSeller).length;

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>Dispute queue</h1>
          <p className={ui.pageSub}>
            {mayResolveAny
              ? 'Cases where decision authority has transferred to you. Your ruling is executed by the contract directly — neither party can override it (FR-05).'
              : 'Read-only oversight of open and settled cases. Your role does not hold authority to direct funds.'}
          </p>
        </div>
      </div>

      <div className={ui.stack}>
        <StatGrid>
          <Stat label="Open cases" value={open.length} icon={<Gavel size={13} />}
            tone={open.length > 0 ? 'blocked' : 'safe'}
            foot={open.length > 0 ? `Oldest raised ${relativeTime(open[open.length - 1].raisedAt)}` : 'Queue is clear'} />
          <Stat label="Value frozen" value={frozen.toFixed(2)} unit="ETH" icon={<Timer size={13} />}
            tone="elevated" foot="Immovable by either party" />
          <Stat label="Resolved" value={closed.length} icon={<ShieldCheck size={13} />}
            tone="safe" foot={`${forSeller} to seller, ${closed.length - forSeller} to buyer`} />
          <Stat label="Dispute window" value={settings.timeLockHours} unit="h" icon={<Timer size={13} />}
            tone="brand" foot="Time lock after delivery confirmation" />
        </StatGrid>

        {!mayResolveAny && (
          <Notice tone="info" icon={<Eye size={15} />} title="Oversight access">
            You can read every case in full, which is what the audit and governance role requires.
            Directing funds is restricted on chain to the arbitrator address named in each escrow.
          </Notice>
        )}

        {open.length === 0 ? (
          <Card>
            <Empty icon={<CheckCircle2 size={19} />} title="Queue is clear">
              No escrow is currently in the DISPUTED state. Cases arrive here when either party
              calls <code className="mono">initiateDispute</code>.
            </Empty>
          </Card>
        ) : (
          <div className={q.caseGrid}>
            {open.map((dispute) => {
              const tx = transactions.find((t) => t.id === dispute.transactionId);
              if (!tx) return null;

              const buyer = USER_BY_ID[tx.buyerId];
              const seller = USER_BY_ID[tx.sellerId];
              const sellerProfile = SELLER_PROFILES[tx.sellerId];
              const mayResolveThis = canResolveDispute(principal, tx, dispute);

              return (
                <article key={dispute.id} className={q.case}>
                  <div className={q.caseMain}>
                    <div className={q.caseHead}>
                      <div>
                        <div className={q.caseRef}>
                          {dispute.id} · <Link href={`/escrows/${tx.id}`}>{tx.id}</Link>
                        </div>
                        <div className={q.caseItem}>{tx.itemDescription}</div>
                      </div>
                      <div className={q.caseAmount}>{eth(tx.amountEth)}</div>
                    </div>

                    <div className={ui.row}>
                      <Badge tone="blocked" dot>Raised by {dispute.raisedByRole}</Badge>
                      <Badge tone="neutral">{relativeTime(dispute.raisedAt)}</Badge>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {absoluteTime(dispute.raisedAt)}
                      </span>
                    </div>

                    <div className={q.claim}>
                      <div className={q.claimLabel}>
                        <MessageSquareWarning size={12} /> Stated grounds
                      </div>
                      <p className={q.claimBody}>{dispute.reason}</p>
                    </div>

                    <div className={q.parties}>
                      <div className={q.party}>
                        <div className={q.partyRole}>Buyer</div>
                        <div className={q.partyName}>{buyer.displayName}</div>
                        <div className={q.partyStat}>Dispute rate 1.4% · 14 prior transactions</div>
                        <div style={{ marginTop: 7 }}><Address value={buyer.walletAddress} /></div>
                      </div>
                      <div className={q.party}>
                        <div className={q.partyRole}>Seller</div>
                        <div className={q.partyName}>{seller.displayName}</div>
                        <div className={q.partyStat}>
                          Dispute rate {pct(sellerProfile.disputeRate)} · {sellerProfile.completed} completed
                        </div>
                        <div style={{ marginTop: 7 }}><Address value={seller.walletAddress} /></div>
                      </div>
                    </div>
                  </div>

                  <aside className={q.caseAside}>
                    <RiskDial
                      score={tx.prediction.riskScore}
                      threshold={settings.riskThreshold}
                      size={140}
                      label="Score recorded at initiation. It describes the transaction, not the delivery in dispute."
                    />
                    {mayResolveThis ? (
                      <Button variant="primary" block onClick={() => setActive({ tx, dispute })}>
                        <Scale size={15} /> Resolve case
                      </Button>
                    ) : (
                      <Badge tone="neutral">
                        {mayResolveAny ? 'Another arbitrator is assigned' : 'Read-only'}
                      </Badge>
                    )}
                    <Link href={`/escrows/${tx.id}`} style={{ width: '100%' }}>
                      <Button variant="ghost" size="sm" block>Full history</Button>
                    </Link>
                  </aside>
                </article>
              );
            })}
          </div>
        )}

        {closed.length > 0 && (
          <Card title="Resolved cases" subtitle="Rulings already enforced on chain.">
            <div className={ui.stackSm}>
              {closed.map((dispute) => {
                const tx = transactions.find((t) => t.id === dispute.transactionId);
                return (
                  <div key={dispute.id} className={q.resolved}>
                    <Gavel size={15} style={{ color: 'var(--safe)', flex: 'none', marginTop: 2 }} />
                    <div>
                      <span className={q.resolvedTitle}>
                        {dispute.id} · {tx ? eth(tx.amountEth) : ''}{' '}
                        {dispute.resolutionForSeller ? 'released to seller' : 'refunded to buyer'}
                      </span>
                      <div style={{ marginTop: 3 }}>{dispute.resolutionNote}</div>
                      <div className={q.resolvedMeta}>
                        {dispute.resolvedAt && absoluteTime(dispute.resolvedAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {active && (
        <ResolveDialog tx={active.tx} dispute={active.dispute} onClose={() => setActive(null)} />
      )}
    </>
  );
}
