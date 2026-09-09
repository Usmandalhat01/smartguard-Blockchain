'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Info } from 'lucide-react';
import { explorer, shortAddress, shortHash } from '@/lib/format';
import s from './ui.module.css';

export type Tone = 'neutral' | 'brand' | 'chain' | 'safe' | 'elevated' | 'high' | 'blocked';

const BADGE_TONE: Record<Tone, string> = {
  neutral: s.badgeNeutral,
  brand: s.badgeBrand,
  chain: s.badgeChain,
  safe: s.badgeSafe,
  elevated: s.badgeElevated,
  high: s.badgeHigh,
  blocked: s.badgeBlocked,
};

/* ---------------------------------------------------------------- card --- */

export function Card({
  title, subtitle, actions, children, flush, className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`${s.card} ${className ?? ''}`}>
      {(title || actions) && (
        <header className={s.cardHeader}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {subtitle && <p className={s.cardSub}>{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? s.cardBodyFlush : s.cardBody}>{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------- badge --- */

export function Badge({
  tone = 'neutral', dot, children,
}: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`${s.badge} ${BADGE_TONE[tone]}`}>
      {dot && <span className={s.badgeDot} />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- button --- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
};

export function Button({
  variant = 'default', size = 'md', block, loading, children, className, disabled, ...rest
}: ButtonProps) {
  const variants = {
    default: '', primary: s.btnPrimary, danger: s.btnDanger,
    success: s.btnSuccess, ghost: s.btnGhost,
  };
  const sizes = { sm: s.btnSm, md: '', lg: s.btnLg };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${s.btn} ${variants[variant]} ${sizes[size]} ${block ? s.btnBlock : ''} ${className ?? ''}`}
    >
      {loading && <span className={s.spinner} aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ addresses -- */

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — the full value is in the title attribute */
    }
  };
  return { copied, copy };
}

export function Address({
  value, link = true, copyable = true, lead, tail,
}: { value: string; link?: boolean; copyable?: boolean; lead?: number; tail?: number }) {
  const { copied, copy } = useCopy();
  const label = shortAddress(value, lead, tail);
  return (
    <span className={`${s.addr} ${link ? s.addrLink : ''}`} title={value}>
      {link ? (
        <a href={explorer.address(value)} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
          {label}
        </a>
      ) : label}
      {copyable && (
        <button
          type="button"
          className={s.copyBtn}
          onClick={() => copy(value)}
          aria-label={copied ? 'Copied' : `Copy address ${value}`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </span>
  );
}

export function TxHash({ value }: { value: string }) {
  return (
    <a
      className={`${s.addr} ${s.addrLink}`}
      href={explorer.tx(value)}
      target="_blank"
      rel="noreferrer"
      title={value}
    >
      {shortHash(value)}
      <ExternalLink size={10} />
    </a>
  );
}

/* ---------------------------------------------------------------- stat --- */

export function Stat({
  label, value, unit, foot, icon, tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
}) {
  const colour = tone && tone !== 'neutral' ? `var(--${tone === 'brand' ? 'brand' : tone})` : undefined;
  return (
    <div className={s.stat}>
      <div className={s.statLabel} style={colour ? { color: colour } : undefined}>
        {icon}
        {label}
      </div>
      <div className={s.statValue}>
        {value}
        {unit && <span className={s.statUnit}>{unit}</span>}
      </div>
      {foot && <div className={s.statFoot}>{foot}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={s.statGrid}>{children}</div>;
}

/* -------------------------------------------------------------- notice --- */

export function Notice({
  tone = 'info', title, icon, children,
}: {
  tone?: 'info' | 'chain' | 'warn' | 'danger' | 'success' | 'plain';
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    info: s.noticeInfo, chain: s.noticeChain, warn: s.noticeWarn,
    danger: s.noticeDanger, success: s.noticeSuccess, plain: '',
  };
  return (
    <div className={`${s.notice} ${tones[tone]}`}>
      <span className={s.noticeIcon}>{icon ?? <Info size={15} />}</span>
      <div>
        {title && <strong className={s.noticeTitle}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- empty --- */

export function Empty({
  icon, title, children, action,
}: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon}>{icon}</span>
      <span className={s.emptyTitle}>{title}</span>
      {children && <p className={s.emptyBody}>{children}</p>}
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- forms --- */

export function Field({
  label, hint, htmlFor, children, aside,
}: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={s.field}>
      <label className={s.fieldLabel} htmlFor={htmlFor}>
        {label}
        {aside}
      </label>
      {children}
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </div>
  );
}

export function CheckRow({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={s.checkRow}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className={s.checkLabel}>{label}</span>
        {hint && <span className={s.checkHint}>{hint}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------ key/value -- */

export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className={s.kv}>
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt className={s.kvKey}>{k}</dt>
          <dd className={s.kvVal} style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export { s as ui };
