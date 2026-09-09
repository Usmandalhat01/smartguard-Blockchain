'use client';

import { useState } from 'react';
import { Check, Gauge, Save, ShieldAlert, Timer } from 'lucide-react';
import { Button, Card, CheckRow, Field, KeyValue, Notice, ui } from '@/components/ui';
import { RiskBar } from '@/components/domain';
import { useStore } from '@/lib/store';
import { pct } from '@/lib/format';
import { DEFAULT_RISK_THRESHOLD, riskBand } from '@/lib/types';
import a from '../admin.module.css';

/**
 * The System Administrator actor of Figure 3.2 configures the risk gate without
 * altering deployed model or contract code. Changing the threshold does not
 * rewrite historical predictions — each stores the value in force when it was
 * made, so a past decision stays interpretable.
 */
export function RiskSettings() {
  const { settings, updateSettings, transactions } = useStore();

  const [threshold, setThreshold] = useState(settings.riskThreshold);
  const [holding, setHolding] = useState(settings.holdingPeriodHours);
  const [timeLock, setTimeLock] = useState(settings.timeLockHours);
  const [failClosed, setFailClosed] = useState(settings.failClosedOnInferenceError);
  const [saved, setSaved] = useState(false);

  const dirty =
    threshold !== settings.riskThreshold ||
    holding !== settings.holdingPeriodHours ||
    timeLock !== settings.timeLockHours ||
    failClosed !== settings.failClosedOnInferenceError;

  const wouldBlock = transactions.filter((t) => t.prediction.riskScore > threshold);
  const currentlyBlocked = transactions.filter((t) => t.prediction.riskScore > settings.riskThreshold);
  const band = riskBand(threshold - 0.001, threshold);

  function save() {
    updateSettings({
      riskThreshold: threshold,
      holdingPeriodHours: holding,
      timeLockHours: timeLock,
      failClosedOnInferenceError: failClosed,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>Risk configuration</h1>
          <p className={ui.pageSub}>
            Governance parameters for the risk gate and the escrow timers. These are changed here
            rather than in deployed model or contract code, which is what makes human oversight of
            the automated decision practical.
          </p>
        </div>
        <Button variant="primary" disabled={!dirty} onClick={save}>
          {saved ? <><Check size={15} /> Saved</> : <><Save size={15} /> Save configuration</>}
        </Button>
      </div>

      <div className={ui.split}>
        <div className={ui.stack}>
          <Card title="Risk gate" subtitle="A score strictly above this value causes depositFunds to revert.">
            <div className={ui.stack}>
              <div>
                <div className={a.thresholdRow}>
                  <span className={`${a.thresholdValue} tnum`} style={{ color: `var(--${band.tone})` }}>
                    {threshold.toFixed(2)}
                  </span>
                  <span className={a.thresholdHint}>
                    P(fraud) above which an escrow is refused
                  </span>
                </div>

                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className={a.slider}
                  aria-label="Risk threshold"
                />

                <div style={{ marginTop: 12 }}>
                  <RiskBar score={threshold} threshold={threshold} />
                </div>
              </div>

              <Notice tone="warn" title="0.75 is a prototype configuration value" icon={<ShieldAlert size={15} />}>
                Section 4.3.6 records that the threshold-sensitivity analysis could not be reproduced
                from retained prediction files. Until it is regenerated from a documented held-out
                split, 0.75 should be described as a configured operating point, not an empirically
                validated optimum.
              </Notice>

              <hr className={ui.divider} />

              <KeyValue rows={[
                ['Escrows on record', transactions.length],
                ['Refused at current gate', `${currentlyBlocked.length} (${pct(currentlyBlocked.length / Math.max(transactions.length, 1), 0)})`],
                ['Refused at proposed gate',
                  <span key="w" style={{ color: wouldBlock.length !== currentlyBlocked.length ? 'var(--elevated)' : undefined }}>
                    {wouldBlock.length} ({pct(wouldBlock.length / Math.max(transactions.length, 1), 0)})
                  </span>],
                ['Reset to reported value',
                  <Button key="r" size="sm" variant="ghost" onClick={() => setThreshold(DEFAULT_RISK_THRESHOLD)}>0.75</Button>],
              ]} />
            </div>
          </Card>

          <Card title="Escrow timers">
            <div className={ui.stack}>
              <Field
                label="Holding period"
                htmlFor="holding"
                hint="How long an escrow may sit in INITIATED before the buyer can call claimRefund (FR-06)."
              >
                <div className={ui.inputRow}>
                  <input id="holding" className={ui.input} type="number" min={1} max={720}
                    value={holding} onChange={(e) => setHolding(Number(e.target.value))} />
                  <span className={ui.inputSuffix}>hours</span>
                </div>
              </Field>

              <Field
                label="Post-delivery time lock"
                htmlFor="timelock"
                hint="Dispute window after the buyer confirms receipt. Section 3.11.1 specifies 48 hours."
              >
                <div className={ui.inputRow}>
                  <input id="timelock" className={ui.input} type="number" min={1} max={336}
                    value={timeLock} onChange={(e) => setTimeLock(Number(e.target.value))} />
                  <span className={ui.inputSuffix}>hours</span>
                </div>
              </Field>

              {timeLock !== 48 && (
                <Notice tone="warn">
                  The documented design specifies a 48-hour lock. A different value here would need
                  to be reflected in the contract and in Section 3.11.1.
                </Notice>
              )}
            </div>
          </Card>

          <Card title="Failure behaviour">
            <CheckRow
              checked={failClosed}
              onChange={setFailClosed}
              label="Fail closed when the inference service is unavailable"
              hint="When enabled, an escrow cannot be initiated without a valid score. When disabled, the request is routed to manual review instead — the graceful-degradation path of Section 3.7.1. Either way, no automated fund release follows a failed or malformed inference."
            />
          </Card>
        </div>

        <div className={ui.stack}>
          <Card title="Effect on records" subtitle="Which escrows the proposed gate would have refused.">
            {wouldBlock.length === 0 ? (
              <p className={a.prose}>
                No transaction on record scores above {threshold.toFixed(2)}. Every escrow currently
                visible would still have been admitted.
              </p>
            ) : (
              <div className={ui.stackSm}>
                {wouldBlock.map((t) => (
                  <div key={t.id} className={a.blockedRow}>
                    <Gauge size={13} style={{ color: 'var(--blocked)', flex: 'none' }} />
                    <code className="mono" style={{ flex: 1 }}>{t.id}</code>
                    <span className="tnum" style={{ fontWeight: 600, color: 'var(--blocked)' }}>
                      {t.prediction.riskScore.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="What does not change">
            <div className={ui.stackSm}>
              <p className={a.prose}>
                Historical predictions keep the threshold that was in force when they were made, so a
                past decision remains interpretable after a change here.
              </p>
              <p className={a.prose}>
                Escrows already in custody are unaffected. The gate applies at initiation only — it
                is a precondition of <code className="mono">depositFunds</code>, not a continuous
                check.
              </p>
              <p className={a.prose}>
                Every change is written to the audit log with the acting administrator address.
              </p>
            </div>
          </Card>

          <Notice tone="info" icon={<Timer size={15} />}>
            In this prototype the settings live in the browser. In deployment they belong in the
            PostgreSQL configuration table, read by the FastAPI service on each scoring request and
            mirrored to the contract&rsquo;s owner-only threshold setter.
          </Notice>
        </div>
      </div>
    </>
  );
}
