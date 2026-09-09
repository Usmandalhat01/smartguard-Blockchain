'use client';

import { useEffect, useState } from 'react';
import { Gavel, X } from 'lucide-react';
import { Button, Field, Notice, ui } from './ui';
import { useStore } from '@/lib/store';
import { USER_BY_ID } from '@/lib/seed';
import { eth } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import d from './dialog.module.css';

/** FR-04. Either party may raise a dispute; authority moves to the arbitrator
 *  and neither party can move the funds afterwards. */
export function DisputeDialog({
  tx, role, onClose,
}: { tx: Transaction; role: 'buyer' | 'seller'; onClose: () => void }) {
  const { initiateDispute, settings } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const arbitrator = USER_BY_ID[tx.arbitratorId];
  const valid = reason.trim().length >= 20;

  async function submit() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 800));
    await initiateDispute(tx.id, role, reason.trim());
    setBusy(false);
    onClose();
  }

  return (
    <div className={d.scrim} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={d.panel} role="dialog" aria-modal="true" aria-label="Raise a dispute">
        <header className={d.head}>
          <span
            className={d.headIcon}
            style={{ background: 'var(--blocked-soft)', color: 'var(--blocked)', border: '1px solid var(--blocked-line)' }}
          >
            <Gavel size={17} />
          </span>
          <div>
            <div className={d.title}>Raise a dispute</div>
            <p className={d.sub}>
              This calls <code className="mono">initiateDispute</code> and moves the escrow to
              DISPUTED. Only {arbitrator.displayName} can release the funds afterwards.
            </p>
          </div>
          <button className={d.close} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className={d.body}>
          <div className={d.summary}>
            <span className={d.summaryKey}>Escrow</span>
            <span className={`${d.summaryVal} mono`}>{tx.id}</span>
            <span className={d.summaryKey}>Amount frozen</span>
            <span className={d.summaryVal}>{eth(tx.amountEth)}</span>
            <span className={d.summaryKey}>Arbitrator</span>
            <span className={d.summaryVal}>{arbitrator.displayName}</span>
          </div>

          <Field
            label="Grounds for the dispute"
            htmlFor="reason"
            hint="Recorded off-chain and shown to the arbitrator in full. At least 20 characters."
          >
            <textarea
              id="reason"
              className={ui.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe what was agreed, what was delivered, and what is in dispute."
              autoFocus
            />
          </Field>

          <Notice tone="warn">
            The {settings.timeLockHours}-hour time lock stops as soon as the dispute is recorded.
            The arbitrator&rsquo;s decision is enforced by the contract and neither party can override it.
          </Notice>
        </div>

        <footer className={d.foot}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!valid} loading={busy} onClick={submit}>
            Submit dispute
          </Button>
        </footer>
      </div>
    </div>
  );
}
