'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity, Boxes, CheckCircle2, Cpu, Fuel, Gavel, Hash, Layers, Link2,
  Lock, Monitor, ShieldAlert, ShieldCheck, Wallet,
} from 'lucide-react';
import { FEATURE_BY_KEY, PROVENANCE_META, type Provenance } from '@/lib/features';
import { absoluteTime, gas, relativeTime, shortAddress } from '@/lib/format';
import {
  AUDIT_LAYER_META, ESCROW_STATES, ESCROW_STATE_META, riskBand,
  type AuditEntry, type AuditLayer, type EscrowState, type FeatureContribution,
} from '@/lib/types';
import { Badge, TxHash, type Tone } from './ui';
import d from './domain.module.css';

/* =========================================================== risk dial === */

const TONE_VAR: Record<string, string> = {
  safe: 'var(--safe)',
  elevated: 'var(--elevated)',
  high: 'var(--high)',
  blocked: 'var(--blocked)',
};

/**
 * The risk readout the buyer sees at initiation and the arbitrator sees during
 * review (FR-08). The gate tick is drawn on the arc itself so the relationship
 * between the score and the on-chain threshold is visible, not inferred.
 */
export function RiskDial({
  score, threshold, size = 168, label,
}: { score: number; threshold: number; size?: number; label?: ReactNode }) {
  const band = riskBand(score, threshold);
  const colour = TONE_VAR[band.tone];

  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // 240° sweep starting at 150° — leaves a readable gap at the bottom.
  const START = 150;
  const SWEEP = 240;
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arc = (from: number, to: number) => {
    const a = polar(from);
    const b = polar(to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
  };

  const gateDeg = START + SWEEP * threshold;
  const gateInner = polar(gateDeg);
  const gateOuterR = r + stroke / 2 + 4;
  const gateOuter = {
    x: cx + gateOuterR * Math.cos((gateDeg * Math.PI) / 180),
    y: cy + gateOuterR * Math.sin((gateDeg * Math.PI) / 180),
  };

  // Animate from zero on mount so the number reads as a measurement arriving.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const arcLength = (2 * Math.PI * r * SWEEP) / 360;

  return (
    <div className={d.dial}>
      <div style={{ position: 'relative', width: size, height: size * 0.78 }}>
        <svg
          className={d.dialSvg}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: 'absolute', top: -size * 0.11 }}
          role="img"
          aria-label={`Risk score ${score.toFixed(4)} of 1. Band: ${band.label}.`}
        >
          <path
            className={d.dialTrack}
            d={arc(START, START + SWEEP)}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <path
            d={arc(START, START + SWEEP)}
            fill="none"
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={arcLength * (1 - shown)}
            style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.22,.9,.3,1)' }}
          />
          <line
            x1={gateInner.x} y1={gateInner.y}
            x2={gateOuter.x} y2={gateOuter.y}
            stroke="var(--text-dim)" strokeWidth={2} strokeLinecap="round"
          />
        </svg>

        <div
          className={d.dialReadout}
          style={{ position: 'absolute', inset: 0, justifyContent: 'center' }}
        >
          <span className={d.dialScore} style={{ color: colour }}>
            {score.toFixed(2)}
          </span>
          <span className={d.dialScale}>P(fraud) · gate {threshold.toFixed(2)}</span>
        </div>
      </div>

      <div className={d.dialMeta}>
        <Badge tone={band.tone as Tone} dot>{band.label} risk</Badge>
        <p className={d.dialGuidance}>{label ?? band.guidance}</p>
      </div>
    </div>
  );
}

/** Compact linear alternative for table rows and dense panels. */
export function RiskBar({ score, threshold }: { score: number; threshold: number }) {
  return (
    <div>
      <div className={d.riskBar}>
        <span className={d.riskBarGate} style={{ left: `${threshold * 100}%` }} />
        <span className={d.riskBarMarker} style={{ left: `${Math.min(score, 1) * 100}%` }} />
      </div>
      <div className={d.riskBarScale}>
        <span>0.00</span>
        <span>1.00</span>
      </div>
    </div>
  );
}

/* ================================================== escrow state machine = */

const STATE_ICON: Record<EscrowState, ReactNode> = {
  INITIATED: <Lock size={13} />,
  DELIVERED: <CheckCircle2 size={13} />,
  DISPUTED: <Gavel size={13} />,
  COMPLETED: <ShieldCheck size={13} />,
};

/**
 * The four states of Section 3.11.1. A disputed escrow skips nothing — it
 * enters DISPUTED from DELIVERED or INITIATED — so the track renders the
 * dispute node dimmed unless it was actually entered.
 */
export function StateMachine({
  state, timestamps, showCaption = true,
}: {
  state: EscrowState;
  timestamps?: Partial<Record<EscrowState, string>>;
  showCaption?: boolean;
}) {
  const currentIndex = ESCROW_STATES.indexOf(state);
  const visited = (s: EscrowState) => {
    const i = ESCROW_STATES.indexOf(s);
    if (s === 'DISPUTED') return state === 'DISPUTED' || Boolean(timestamps?.DISPUTED);
    return i < currentIndex || i === currentIndex;
  };

  return (
    <div>
      <div className={d.states}>
        {ESCROW_STATES.map((sName, i) => {
          const meta = ESCROW_STATE_META[sName];
          const isCurrent = sName === state;
          const isDone = visited(sName) && !isCurrent;
          const cls = isCurrent ? d.stateNodeCurrent : isDone ? d.stateNodeDone : d.stateNodeFuture;
          const ts = timestamps?.[sName];
          return (
            <div
              key={sName}
              className={`${d.stateNode} ${cls}`}
              style={isCurrent ? { color: TONE_VAR[meta.tone] ?? 'var(--brand)' } : undefined}
            >
              <div className={d.stateIndex}>Step {i + 1}</div>
              <div className={d.stateName}>
                <span style={{ color: isCurrent || isDone ? TONE_VAR[meta.tone] : 'var(--text-muted)' }}>
                  {STATE_ICON[sName]}
                </span>
                {meta.label}
              </div>
              <div className={d.stateTime}>
                {ts ? absoluteTime(ts) : isCurrent ? 'Current state' : '—'}
              </div>
            </div>
          );
        })}
      </div>
      {showCaption && <p className={d.stateCaption}>{ESCROW_STATE_META[state].description}</p>}
    </div>
  );
}

/* ==================================================== four-layer trace === */

export type LayerStatus = 'idle' | 'active' | 'done' | 'failed';

export interface LayerStep {
  layer: AuditLayer;
  detail: string;
  status: LayerStatus;
  timing?: string;
}

const LAYER_ICON: Record<AuditLayer, ReactNode> = {
  presentation: <Monitor size={13} />,
  application: <Cpu size={13} />,
  oracle: <Link2 size={13} />,
  blockchain: <Boxes size={13} />,
};

const LAYER_COLOUR: Record<AuditLayer, string> = {
  presentation: 'var(--text-dim)',
  application: 'var(--brand)',
  oracle: 'var(--chain)',
  blockchain: 'var(--chain)',
};

/**
 * Renders one request's passage through the four layers of Section 3.7.
 * This is the architecture made observable: the same diagram the report draws
 * statically, driven by what the system actually just did.
 */
export function LayerTrace({ steps }: { steps: LayerStep[] }) {
  return (
    <div className={d.layers}>
      {steps.map((step, i) => {
        const meta = AUDIT_LAYER_META[step.layer];
        const colour = step.status === 'failed' ? 'var(--blocked)' : LAYER_COLOUR[step.layer];
        const cls =
          step.status === 'active' ? d.layerActive
          : step.status === 'done' || step.status === 'failed' ? d.layerDone
          : d.layerIdle;
        const lit = step.status !== 'idle';
        return (
          <div key={`${step.layer}-${i}`}>
            {i > 0 && <div className={d.layerConnector} />}
            <div className={`${d.layer} ${cls}`} style={lit ? { color: colour } : undefined}>
              <span
                className={`${d.layerIcon} ${lit ? d.layerIconOn : ''}`}
                style={lit ? { color: colour } : undefined}
              >
                {step.status === 'active'
                  ? <Activity size={13} style={{ color: 'var(--surface)' }} />
                  : LAYER_ICON[step.layer]}
              </span>
              <div>
                <div className={d.layerName}>{meta.label}</div>
                <div className={d.layerDetail}>{step.detail}</div>
              </div>
              {step.timing && <span className={d.layerTiming}>{step.timing}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ======================================================= audit timeline == */

const EVENT_ICON = (entry: AuditEntry): ReactNode => {
  if (entry.eventType.startsWith('contract.')) return <Boxes size={12} />;
  if (entry.eventType.startsWith('ai.')) return <Cpu size={12} />;
  if (entry.eventType.startsWith('risk.gate')) return <ShieldAlert size={12} />;
  if (entry.eventType.startsWith('admin.')) return <Layers size={12} />;
  if (entry.eventType.startsWith('ui.')) return <Monitor size={12} />;
  return <Activity size={12} />;
};

const LAYER_TONE: Record<AuditLayer, Tone> = {
  presentation: 'neutral',
  application: 'brand',
  oracle: 'chain',
  blockchain: 'chain',
};

/**
 * FR-09 / NFR-06. On-chain and off-chain events reconstructed into a single
 * chronological view, which is the whole point of the generic AuditLog table.
 */
export function AuditTimeline({ entries, limit }: { entries: AuditEntry[]; limit?: number }) {
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <div className={d.timeline}>
      {shown.map((entry) => (
        <div key={entry.id} className={d.tlItem}>
          <span
            className={d.tlMarker}
            style={{ color: LAYER_COLOUR[entry.layer] }}
          >
            {EVENT_ICON(entry)}
          </span>
          <div className={d.tlBody}>
            <div className={d.tlHead}>
              <span className={d.tlEvent}>{entry.eventType}</span>
              <Badge tone={LAYER_TONE[entry.layer]}>{AUDIT_LAYER_META[entry.layer].short}</Badge>
              <span className={d.tlTime} title={absoluteTime(entry.createdAt)}>
                {relativeTime(entry.createdAt)}
              </span>
            </div>
            <p className={d.tlSummary}>{entry.summary}</p>
            {(entry.txHash || entry.gasUsed || entry.actorAddress) && (
              <div className={d.tlMeta}>
                {entry.txHash && (
                  <span className={d.tlMetaItem}>
                    <Hash size={11} /> <TxHash value={entry.txHash} />
                  </span>
                )}
                {entry.gasUsed != null && (
                  <span className={d.tlMetaItem}>
                    <Fuel size={11} /> {gas(entry.gasUsed)} gas
                  </span>
                )}
                {entry.blockNumber != null && (
                  <span className={d.tlMetaItem}>block {entry.blockNumber.toLocaleString('en-GB')}</span>
                )}
                {entry.actorAddress && (
                  <span className={d.tlMetaItem}>
                    <Wallet size={11} /> {shortAddress(entry.actorAddress)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================================================ feature contributions == */

export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  const cls = {
    original: d.provOriginal,
    derived: d.provDerived,
    simulated: d.provSimulated,
  }[provenance];
  const short = { original: 'PaySim', derived: 'Derived', simulated: 'Proxy' }[provenance];
  return (
    <span className={`${d.provChip} ${cls}`} title={PROVENANCE_META[provenance].note}>
      {short}
    </span>
  );
}

/**
 * Which features pushed this score where. Bars are centred on zero: right is
 * toward the fraud class, left is away from it.
 */
export function ContributionBars({ contributions }: { contributions: FeatureContribution[] }) {
  const max = Math.max(0.05, ...contributions.map((c) => Math.abs(c.contribution)));
  return (
    <div className={d.contribs}>
      {contributions.map((c) => {
        const def = FEATURE_BY_KEY[c.feature];
        const width = (Math.abs(c.contribution) / max) * 50;
        const raises = c.contribution >= 0;
        return (
          <div key={c.feature} className={d.contrib}>
            <span className={d.contribName}>
              {def?.label ?? c.feature}
              {def && <ProvenanceChip provenance={def.provenance} />}
            </span>
            <span className={d.contribValue}>{c.value}</span>
            <span className={d.contribTrack}>
              <span className={d.contribAxis} />
              <span
                className={`${d.contribFill} ${raises ? d.contribRaise : d.contribLower}`}
                style={raises
                  ? { left: '50%', width: `${width}%` }
                  : { right: '50%', width: `${width}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
