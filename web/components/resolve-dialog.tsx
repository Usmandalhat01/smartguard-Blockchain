'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Scale, ShieldCheck, Undo2, X } from 'lucide-react';
import { Button, Field, Notice, ui } from './ui';
import { useStore } from '@/lib/store';
import { USER_BY_ID } from '@/lib/seed';
import { eth } from '@/lib/format';
import type { Dispute, Transaction } from '@/lib/types';
import d from './dialog.module.css';

/**
 * FR-05. `resolveDispute(bool)` — true releases to the seller, false refunds
 * the buyer. Restricted on chain to the arbitrator address recorded in the
 * escrow, so this dialog exists only in the arbitrator workspace.
 */
export function ResolveDialog({
  tx, dispute, onClose,
}: { tx: Transaction; dispute: Dispute; onClose: () => void }) {
  const { resolveDispute } = useStore();
  const [forSeller, setForSeller] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seller = USER_BY_ID[tx.sellerId];
  const buyer = USER_BY_ID[tx.buyerId];
  const valid = forSeller !== null && note.trim().length >= 20;

  async function submit() {
    if (forSeller === null) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 900));
    await resolveDispute(tx.id, forSeller, note.trim());
    setBusy(false);
    onClose();
  }

  return (
    <div className={d.scrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${d.panel} ${d.panelWide}`} role="dialog" aria-modal="true" aria-label="Resolve dispute">
        <header className={d.head}>
          <span
            className={d.headIcon}
            style={{ background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid var(--brand-line)' }}
          >
            <Scale size={17} />
          </span>
          <div>
            <div className={d.title}>Resolve {dispute.id}</div>
            <p className={d.sub}>
              Your decision is executed by the contract immediately and cannot be reversed by
              either party.
            </p>
          </div>
          <button className={d.close} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className={d.body}>
          <div className={d.summary}>
            <span className={d.summaryKey}>Escrow</span>
            <span className={`${d.summaryVal} mono`}>{tx.id}</span>
            <span className={d.summaryKey}>Amount in custody</span>
            <span className={d.summaryVal}>{eth(tx.amountEth)}</span>
            <span className={d.summaryKey}>Risk score at initiation</span>
            <span className={`${d.summaryVal} tnum`}>{tx.prediction.riskScore.toFixed(4)}</span>
            <span className={d.summaryKey}>Raised by</span>
            <span className={d.summaryVal} style={{ textTransform: 'capitalize' }}>{dispute.raisedByRole}</span>
          </div>

          <Field label="Direction of the ruling">
            <div className={d.choices}>
              <button
                type="button"
                className={`${d.choice} ${d.choiceSeller} ${forSeller === true ? d.choiceOn : ''}`}
                onClick={() => setForSeller(true)}
                aria-pressed={forSeller === true}
              >
                <span className={d.choiceHead}>
                  <ShieldCheck size={15} style={{ color: 'var(--safe)' }} />
                  Release to seller
                </span>
                <span className={d.choiceBody}>
                  {eth(tx.amountEth)} is transferred to {seller.displayName}.
                </span>
                <span className={d.choiceCall}>resolveDispute(true)</span>
              </button>

              <button
                type="button"
                className={`${d.choice} ${d.choiceBuyer} ${forSeller === false ? d.choiceOn : ''}`}
                onClick={() => setForSeller(false)}
                aria-pressed={forSeller === false}
              >
                <span className={d.choiceHead}>
                  <Undo2 size={15} style={{ color: 'var(--chain)' }} />
                  Refund to buyer
                </span>
                <span className={d.choiceBody}>
                  {eth(tx.amountEth)} is returned to {buyer.displayName}.
                </span>
                <span className={d.choiceCall}>resolveDispute(false)</span>
              </button>
            </div>
          </Field>

          <Field
            label="Reasoning"
            htmlFor="note"
            hint="Recorded against the dispute and visible to both parties. At least 20 characters."
          >
            <textarea
              id="note"
              className={ui.textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="State the evidence relied on and why it supports this direction."
            />
          </Field>

          <Notice tone="info" icon={<ArrowLeftRight size={15} />}>
            The risk score is one input among several. It describes the transaction at initiation
            and is not evidence about the delivery in dispute.
          </Notice>
        </div>

        <footer className={d.foot}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={submit}>
            Execute ruling
          </Button>
        </footer>
      </div>
    </div>
  );
}
