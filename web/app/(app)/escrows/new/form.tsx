'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertOctagon, ArrowRight, CheckCircle2, Fingerprint, Gauge, Lock, Package,
  ShieldCheck, Timer, Wallet,
} from 'lucide-react';
import {
  Address, Badge, Button, Card, CheckRow, Field, KeyValue, Notice, ui,
} from '@/components/ui';
import { ContributionBars, LayerTrace, RiskDial, type LayerStep } from '@/components/domain';
import { useSession } from '@/lib/auth/context';
import { requestRiskScore, useStore } from '@/lib/store';
import { SELLER_PROFILES, USER_BY_ID } from '@/lib/seed';
import type { ScoringInput } from '@/lib/engine';
import { eth, pct } from '@/lib/format';
import type { FeatureContribution } from '@/lib/types';
import s from './new.module.css';

type Phase = 'idle' | 'scoring' | 'scored' | 'depositing' | 'done';

interface Assessment {
  riskScore: number;
  latencyMs: number;
  contributions: FeatureContribution[];
  source: 'model' | 'simulated';
}

const SELLERS = ['u-seller', 'u-seller3', 'u-seller2'];

export function NewEscrowForm() {
  const router = useRouter();
  const { principal } = useSession();
  const { settings, createEscrow, contracts, backendConnected } = useStore();

  const [sellerId, setSellerId] = useState('u-seller');
  const [amount, setAmount] = useState('1.5');
  const [item, setItem] = useState('');
  const [channel, setChannel] = useState<'web' | 'mobile'>('web');

  // Signals a deployment would derive from the request itself. They are
  // editable here so the risk gate can be exercised deliberately during
  // evaluation rather than only by chance.
  const [highRiskGeo, setHighRiskGeo] = useState(false);
  const [deviceConsistent, setDeviceConsistent] = useState(true);
  const [offHours, setOffHours] = useState(false);
  const [velocity, setVelocity] = useState(1);

  const [phase, setPhase] = useState<Phase>('idle');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountEth = Number.parseFloat(amount) || 0;
  const seller = USER_BY_ID[sellerId];
  const profile = SELLER_PROFILES[sellerId];

  /** Any input change invalidates the score — a stale assessment must never
   *  be the one that admits a different transaction. */
  const invalidate = () => { setAssessment(null); setPhase('idle'); };

  const scoringInput = useMemo<ScoringInput>(() => ({
    amountEth,
    sellerAddress: seller.walletAddress,
    buyerAddress: principal.walletAddress,
    accountAgeDays: 189,
    velocity24h: velocity,
    counterpartyReputation: profile.reputation,
    sellerDisputeRate: profile.disputeRate,
    buyerDisputeRate: 0.014,
    deviceConsistent,
    highRiskGeo,
    offHours,
    meanAmount30d: 1.6,
    channel,
  }), [amountEth, seller, principal, velocity, profile, deviceConsistent, highRiskGeo, offHours, channel]);

  const blocked = assessment ? assessment.riskScore > settings.riskThreshold : false;
  const valid = amountEth > 0 && item.trim().length >= 6;

  /** FR-02 — the gate runs before anything is committed on chain. */
  async function runAssessment() {
    setError(null);
    setPhase('scoring');
    setAssessment(null);
    try {
      const result = await requestRiskScore(scoringInput);
      setAssessment(result);
      setPhase('scored');
    } catch {
      setPhase('idle');
      setError(
        settings.failClosedOnInferenceError
          ? 'The risk-scoring service did not respond. The system is configured to fail closed, so this escrow cannot be initiated until scoring succeeds.'
          : 'The risk-scoring service did not respond. This request has been routed to manual review.',
      );
    }
  }

  /** FR-01 — oracle write, then depositFunds. */
  async function deposit() {
    if (!assessment || blocked) return;
    setPhase('depositing');
    await new Promise((r) => setTimeout(r, 900));
    const tx = await createEscrow({
      sellerId,
      amountEth,
      itemDescription: item.trim(),
      scoring: scoringInput,
      prediction: {
        riskScore: assessment.riskScore,
        latencyMs: assessment.latencyMs,
        contributions: assessment.contributions,
      },
    });
    setCreatedId(tx.id);
    setPhase('done');
  }

  const steps: LayerStep[] = [
    {
      layer: 'presentation',
      detail: valid ? `${eth(amountEth)} to ${seller.displayName}` : 'Awaiting a complete request',
      status: phase === 'idle' ? (valid ? 'done' : 'idle') : 'done',
    },
    {
      layer: 'application',
      detail: assessment
        ? `Random Forest returned P(fraud) = ${assessment.riskScore.toFixed(4)}`
        : 'Feature vector assembled, awaiting inference',
      status: phase === 'scoring' ? 'active' : assessment ? 'done' : 'idle',
      timing: assessment ? `${assessment.latencyMs} ms` : undefined,
    },
    {
      layer: 'oracle',
      detail: blocked
        ? 'Not called — the gate rejected before any on-chain write'
        : phase === 'done'
          ? 'Risk score written to RiskOracleContract'
          : 'updateRiskScore(escrowId, score)',
      status: blocked ? 'failed' : phase === 'depositing' ? 'active' : phase === 'done' ? 'done' : 'idle',
    },
    {
      layer: 'blockchain',
      detail: blocked
        ? 'depositFunds would revert: score above the configured gate'
        : phase === 'done'
          ? `${eth(amountEth)} locked in EscrowContract`
          : 'depositFunds() reads the score, then takes custody',
      status: blocked ? 'failed' : phase === 'depositing' ? 'active' : phase === 'done' ? 'done' : 'idle',
    },
  ];

  /* ------------------------------------------------------------ success -- */

  if (phase === 'done' && createdId) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <Card>
          <div className={s.receipt}>
            <span className={s.receiptIcon}><CheckCircle2 size={26} /></span>
            <div>
              <h1 className={ui.pageTitle} style={{ fontSize: '1.25rem' }}>Escrow initiated</h1>
              <p className={ui.pageSub} style={{ margin: '6px auto 0' }}>
                {eth(amountEth)} is now held by EscrowContract. {seller.displayName} must fulfil
                delivery within {settings.holdingPeriodHours} hours, after which you may reclaim
                the funds.
              </p>
            </div>

            <div style={{ width: '100%', textAlign: 'left' }}>
              <KeyValue rows={[
                ['Escrow reference', <span key="r" className="mono">{createdId}</span>],
                ['Amount in custody', eth(amountEth)],
                ['Risk score at deposit', <span key="s" className="tnum">{assessment?.riskScore.toFixed(4)}</span>],
                ['Contract', <Address key="c" value={contracts.escrow} />],
              ]} />
            </div>

            <div className={ui.row} style={{ justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => router.push(`/escrows/${createdId}`)}>
                View escrow <ArrowRight size={15} />
              </Button>
              <Button onClick={() => { setPhase('idle'); setAssessment(null); setCreatedId(null); setItem(''); }}>
                Start another
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  /* --------------------------------------------------------------- form -- */

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>New escrow</h1>
          <p className={ui.pageSub}>
            Funds are assessed before they are committed. The risk score is written on chain by the
            oracle first, and <code className="mono">depositFunds</code> reads it back and reverts
            if it exceeds the configured gate — so the check cannot be bypassed by calling the
            contract directly.
          </p>
        </div>
      </div>

      <div className={s.grid}>
        <div className={s.form}>
          <Card
            title="Counterparty"
            subtitle="Reputation and dispute history feed the model's two highest-weighted features."
          >
            <div className={ui.stackSm}>
              {SELLERS.map((id) => {
                const candidate = USER_BY_ID[id];
                const stats = SELLER_PROFILES[id];
                const isOn = id === sellerId;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${s.sellerOption} ${isOn ? s.sellerOptionActive : ''}`}
                    onClick={() => { setSellerId(id); invalidate(); }}
                    aria-pressed={isOn}
                  >
                    <span className={`${s.sellerRadio} ${isOn ? s.sellerRadioOn : ''}`} />
                    <span style={{ flex: 1 }}>
                      <span className={s.sellerName}>{candidate.displayName}</span>
                      <span className={s.sellerMeta}>
                        <span className={s.sellerStat}><Wallet size={11} /> {candidate.walletAddress.slice(0, 10)}…</span>
                        <span className={s.sellerStat}><ShieldCheck size={11} /> {pct(stats.reputation)} clean</span>
                        <span className={s.sellerStat}><Package size={11} /> {stats.completed} completed</span>
                        <span className={s.sellerStat} style={{ color: stats.disputeRate > 0.1 ? 'var(--blocked)' : undefined }}>
                          <AlertOctagon size={11} /> {pct(stats.disputeRate)} disputed
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Transaction">
            <div className={ui.stack}>
              <div className={s.formRow}>
                <Field label="Amount" htmlFor="amount" hint="Held by the contract until release or refund.">
                  <div className={ui.inputRow}>
                    <input
                      id="amount"
                      className={ui.input}
                      type="number"
                      min="0.001"
                      step="0.01"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); invalidate(); }}
                    />
                    <span className={ui.inputSuffix}>ETH</span>
                  </div>
                </Field>

                <Field label="Channel" htmlFor="channel" hint="One-hot encoded as feature 11.">
                  <select
                    id="channel"
                    className={ui.select}
                    value={channel}
                    onChange={(e) => { setChannel(e.target.value as 'web' | 'mobile'); invalidate(); }}
                  >
                    <option value="web">Web interface</option>
                    <option value="mobile">Mobile application</option>
                  </select>
                </Field>
              </div>

              <Field
                label="What is being purchased"
                htmlFor="item"
                hint="Recorded off-chain and shown to the arbitrator if a dispute is raised."
              >
                <textarea
                  id="item"
                  className={ui.textarea}
                  placeholder="e.g. Refurbished MacBook Pro 14 inch, M3, 512GB — collection from Abuja"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card
            title="Session signals"
            subtitle="Normally derived from the request itself. Exposed here so the gate can be exercised deliberately during evaluation."
          >
            <div className={ui.stackSm}>
              <CheckRow
                checked={highRiskGeo}
                onChange={(v) => { setHighRiskGeo(v); invalidate(); }}
                label="IP geolocation resolves to a high-risk jurisdiction"
                hint="Feature 6 — simulated proxy, binary."
              />
              <CheckRow
                checked={!deviceConsistent}
                onChange={(v) => { setDeviceConsistent(!v); invalidate(); }}
                label="Device fingerprint does not match the historical session profile"
                hint="Feature 9 — simulated proxy, binary."
              />
              <CheckRow
                checked={offHours}
                onChange={(v) => { setOffHours(v); invalidate(); }}
                label="Initiated between 23:00 and 05:00 local time"
                hint="Feature 8 — derived from the transaction timestamp."
              />
              <Field
                label="Initiation attempts in the last 24 hours"
                htmlFor="velocity"
                hint="Feature 3 — velocity is the fourth-ranked feature by reported Gini importance."
              >
                <input
                  id="velocity"
                  className={ui.input}
                  type="number"
                  min={0}
                  max={40}
                  value={velocity}
                  onChange={(e) => { setVelocity(Number(e.target.value)); invalidate(); }}
                />
              </Field>
            </div>
          </Card>
        </div>

        <div className={s.gatePanel}>
          <Card title="Risk gate" subtitle={`Threshold ${settings.riskThreshold.toFixed(2)} · model ${settings.modelVersion}`}>
            {!assessment ? (
              <div className={s.gateIdle}>
                <span className={s.gateIdleIcon}>
                  {phase === 'scoring' ? <span className={ui.spinner} /> : <Gauge size={21} />}
                </span>
                <p className={s.gateIdleText}>
                  {phase === 'scoring'
                    ? 'Scoring the eighteen-feature vector…'
                    : 'Complete the request, then run the assessment. No funds move until the score clears the gate.'}
                </p>
                {error && <Notice tone="danger" icon={<AlertOctagon size={15} />}>{error}</Notice>}
                <Button variant="primary" onClick={runAssessment} disabled={!valid} loading={phase === 'scoring'}>
                  Run risk assessment
                </Button>
                {!valid && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Enter an amount and a description of at least six characters.
                  </span>
                )}
              </div>
            ) : (
              <div className={ui.stack}>
                <RiskDial score={assessment.riskScore} threshold={settings.riskThreshold} />

                <div className={blocked ? `${s.verdict} ${s.verdictBlock}` : `${s.verdict} ${s.verdictPass}`}>
                  {blocked ? <Lock size={16} /> : <ShieldCheck size={16} />}
                  {blocked
                    ? `Blocked — ${assessment.riskScore.toFixed(2)} exceeds the ${settings.riskThreshold.toFixed(2)} gate.`
                    : `Cleared — ${assessment.riskScore.toFixed(2)} is within the ${settings.riskThreshold.toFixed(2)} gate.`}
                </div>

                <div>
                  <div className={s.sectionLabel}><Fingerprint size={12} /> Contributing features</div>
                  <ContributionBars contributions={assessment.contributions} />
                </div>

                <hr className={ui.divider} />

                <KeyValue rows={[
                  ['Inference time', <span key="l" className="tnum">{assessment.latencyMs} ms</span>],
                  ['NFR-01 budget', '2000 ms'],
                  ['Score source', assessment.source === 'model'
                    ? <Badge key="b" tone="brand">Trained model</Badge>
                    : <Badge key="b" tone="elevated">Local stand-in</Badge>],
                ]} />

                {blocked ? (
                  <Notice tone="danger" title="This escrow cannot proceed" icon={<AlertOctagon size={15} />}>
                    The oracle will not write a passing score and <code className="mono">depositFunds</code> would
                    revert. Nothing has been committed and no gas has been consumed. Adjust the
                    request or choose a different counterparty.
                  </Notice>
                ) : (
                  <Button variant="primary" block loading={phase === 'depositing'} onClick={deposit}>
                    <Lock size={15} /> Deposit {eth(amountEth)} into escrow
                  </Button>
                )}

                <Button variant="ghost" size="sm" block onClick={invalidate}>
                  Re-score with different inputs
                </Button>
              </div>
            )}
          </Card>

          <Card title="Request path">
            <LayerTrace steps={steps} />
          </Card>

          {!backendConnected && (
            <Notice tone="warn" title="Scores are not model output" icon={<Timer size={15} />}>
              Until the FastAPI service is connected, this panel shows a deterministic stand-in that
              consumes the same feature vector. It is reproducible but it is not evidence of model
              performance.
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}
