'use client';

import Link from 'next/link';
import {
  ArrowRight, Boxes, CheckCircle2, Cpu, Gauge, Gavel, Link2, Lock, LogIn,
  Monitor, Moon, ScrollText, Settings2, Shield, ShieldCheck, Sun, User, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_PERMISSIONS } from '@/lib/auth/policy';
import { useTheme } from '@/lib/theme';
import type { Role } from '@/lib/types';
import s from './home.module.css';

const LAYERS = [
  { icon: <Monitor size={15} />, name: 'Presentation layer', tech: 'React · Next.js', colour: 'var(--text-dim)', edge: 'submits transaction' },
  { icon: <Cpu size={15} />, name: 'Application & intelligence layer', tech: 'FastAPI · scikit-learn · PostgreSQL', colour: 'var(--brand)', edge: 'returns P(fraud)' },
  { icon: <Link2 size={15} />, name: 'Oracle / integration layer', tech: 'Web3.py bridge', colour: 'var(--chain)', edge: 'writes score on chain' },
  { icon: <Boxes size={15} />, name: 'Blockchain layer', tech: 'Solidity 0.8.19 · Sepolia', colour: 'var(--chain)', edge: null },
];

const MECHANISMS = [
  {
    icon: <Gauge size={17} />, tone: 'brand', tag: 'FR-01 · FR-02',
    title: 'The score gates the deposit',
    body: 'A Random Forest scores an eighteen-feature vector before any funds move. The oracle writes that score on chain, and depositFunds reads it back and reverts above the configured gate.',
  },
  {
    icon: <Lock size={17} />, tone: 'chain', tag: 'FR-03 · FR-05',
    title: 'The contract holds the money',
    body: 'Funds sit in EscrowContract through four states. A buyer confirms, a 48-hour lock runs, and only then does the contract release — or an arbitrator directs it.',
  },
  {
    icon: <Gavel size={17} />, tone: 'elevated', tag: 'FR-04',
    title: 'Disputes freeze both parties',
    body: 'Either side may raise a dispute inside the window. Decision authority moves to the designated arbitrator address, and neither party can override the outcome.',
  },
  {
    icon: <ScrollText size={17} />, tone: 'safe', tag: 'FR-09 · NFR-06',
    title: 'Everything is reconstructable',
    body: 'Each inference, oracle write and contract call is recorded with its layer, actor, hash and gas — so an AI-influenced decision can be reviewed after the fact.',
  },
];

const ROLE_ICON: Record<Role, React.ReactNode> = {
  buyer: <User size={18} />,
  seller: <ShieldCheck size={18} />,
  arbitrator: <Gavel size={18} />,
  admin: <Settings2 size={18} />,
};

const ROLES: Role[] = ['buyer', 'seller', 'arbitrator', 'admin'];

const DOES = [
  'Demonstrates an oracle-mediated path from an off-chain risk score to an on-chain decision gate.',
  'Implements the four escrow states, the five contract entry points and the four stakeholder workflows.',
  'Enforces role-based access at the route, at the server, and — for anything touching funds — at the contract.',
  'Keeps every AI decision auditable, with the threshold in force at the time stored alongside the score.',
];

const DOES_NOT = [
  'Establish production fraud-detection effectiveness. Training data is synthetic PaySim, not escrow records.',
  'Claim statistical superiority for Random Forest. No inferential test was conducted between classifiers.',
  'Offer a decentralised oracle. The bridge is a single trusted relay, which concentrates trust by design.',
  'Present verified performance figures. Gas, latency and throughput are descriptive, not reproducible benchmarks.',
];

export default function Home() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className={s.page}>
      <header className={s.topbar}>
        <div className={s.brand}>
          <span className={s.brandMark}><Shield size={17} /></span>
          <span className={s.brandName}>SmartGuard</span>
        </div>
        <div className={s.topActions}>
          <button
            className={s.iconBtn}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <Link href="/login">
            <Button variant="primary" size="sm"><LogIn size={14} /> Sign in</Button>
          </Link>
        </div>
      </header>

      <section className={s.hero}>
        <div className={s.heroGrid} />
        <div className={s.heroInner}>
          <div>
            <span className={s.eyebrow}>
              <Shield size={12} /> Final-year software engineering project · prototype
            </span>

            <h1 className={s.title}>
              A fraud score that a smart contract{' '}
              <span className={s.titleAccent}>actually enforces</span>.
            </h1>

            <p className={s.lede}>
              A machine-learning model can predict that a transaction is fraudulent but cannot stop
              it. A smart contract can stop a transaction but cannot tell a first-time seller from a
              fraudulent one. SmartGuard connects the two through an oracle, so a risk estimate
              becomes a precondition of custody rather than an advisory alert someone has to act on.
            </p>

            <div className={s.heroCtas}>
              <Link href="/login">
                <Button variant="primary" size="lg"><LogIn size={16} /> Sign in to the system</Button>
              </Link>
              <Link href="#architecture">
                <Button size="lg">How it works</Button>
              </Link>
            </div>

            <div className={s.heroMeta}>
              <div>
                <div className={s.metaValue}>4</div>
                <div className={s.metaLabel}>architectural layers</div>
              </div>
              <div>
                <div className={s.metaValue}>18</div>
                <div className={s.metaLabel}>engineered features</div>
              </div>
              <div>
                <div className={s.metaValue}>6.36M</div>
                <div className={s.metaLabel}>PaySim training records</div>
              </div>
              <div>
                <div className={s.metaValue}>0.75</div>
                <div className={s.metaLabel}>configured risk gate</div>
              </div>
            </div>
          </div>

          <div className={s.diagram} id="architecture">
            <div className={s.diagramHead}>
              <span className={s.diagramDots}>
                <span className={s.diagramDot} />
                <span className={s.diagramDot} />
                <span className={s.diagramDot} />
              </span>
              <span className={s.diagramTitle}>escrow initiation · request path</span>
            </div>
            <div className={s.diagramBody}>
              {LAYERS.map((layer, i) => (
                <div key={layer.name}>
                  <div className={s.dNode}>
                    <span className={s.dIcon} style={{ color: layer.colour }}>{layer.icon}</span>
                    <div>
                      <div className={s.dName}>{layer.name}</div>
                      <div className={s.dTech}>{layer.tech}</div>
                    </div>
                    <span className={s.dLayer}>L{i + 1}</span>
                  </div>
                  {layer.edge && (
                    <>
                      <div className={s.dArrowLine} />
                      <div className={s.dArrow}><ArrowRight size={11} /> {layer.edge}</div>
                      <div className={s.dArrowLine} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${s.section} ${s.sectionAlt}`}>
        <div className={s.sectionInner}>
          <div className={s.sectionEyebrow}>How it works</div>
          <h2 className={s.sectionTitle}>Enforcement, not advice</h2>
          <p className={s.sectionLede}>
            The risk check is a contractual precondition, not a front-end validation. A technically
            capable attacker who submits directly to the contract still hits the same gate, because
            the contract reads the score from the oracle itself.
          </p>

          <div className={s.cardGrid}>
            {MECHANISMS.map((m) => (
              <article key={m.title} className={s.featCard}>
                <span
                  className={s.featIcon}
                  style={{
                    background: `var(--${m.tone}-soft)`,
                    color: `var(--${m.tone})`,
                    border: `1px solid var(--${m.tone}-line)`,
                  }}
                >
                  {m.icon}
                </span>
                <h3 className={s.featTitle}>{m.title}</h3>
                <p className={s.featBody}>{m.body}</p>
                <span className={s.featTag}>{m.tag}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionInner}>
          <div className={s.sectionEyebrow}>Access control</div>
          <h2 className={s.sectionTitle}>Four roles, each a separate sign-in</h2>
          <p className={s.sectionLede}>
            Permissions are bound to the account, carried in a server-signed session cookie, and
            checked at the route, at the server component and at the API. Anything that moves funds
            is additionally restricted by an address modifier on the contract, which no client can
            circumvent.
          </p>

          <div className={s.roleGrid}>
            {ROLES.map((role) => (
              <article key={role} className={s.roleCard}>
                <span className={s.roleIcon}>{ROLE_ICON[role]}</span>
                <div className={s.roleName}>{ROLE_LABEL[role]}</div>
                <p className={s.roleBody}>{ROLE_DESCRIPTION[role]}</p>
                <div className={s.rolePerms}>
                  {ROLE_PERMISSIONS[role].slice(0, 3).map((permission) => (
                    <code key={permission} className={s.perm}>{permission}</code>
                  ))}
                  {ROLE_PERMISSIONS[role].length > 3 && (
                    <code className={s.perm}>+{ROLE_PERMISSIONS[role].length - 3}</code>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${s.section} ${s.sectionAlt}`}>
        <div className={s.sectionInner}>
          <div className={s.sectionEyebrow}>Scope</div>
          <h2 className={s.sectionTitle}>What this prototype does and does not establish</h2>
          <p className={s.sectionLede}>
            The contribution is an implemented and evaluated integration pattern, not evidence of
            production readiness. Stating the boundary precisely is part of the work.
          </p>

          <div className={s.scopeGrid}>
            <div className={`${s.scopeCol} ${s.scopeDoes}`}>
              <div className={s.scopeHead}><CheckCircle2 size={16} /> It does</div>
              <ul className={s.scopeList}>
                {DOES.map((item) => (
                  <li key={item} className={s.scopeItem}>
                    <CheckCircle2 size={14} className={s.scopeBullet} style={{ color: 'var(--safe)' }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`${s.scopeCol} ${s.scopeNot}`}>
              <div className={s.scopeHead}><XCircle size={16} /> It does not</div>
              <ul className={s.scopeList}>
                {DOES_NOT.map((item) => (
                  <li key={item} className={s.scopeItem}>
                    <XCircle size={14} className={s.scopeBullet} style={{ color: 'var(--blocked)' }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className={s.footer}>
        <div className={s.footerInner}>
          <div className={s.brand}>
            <span className={s.brandMark}><Shield size={17} /></span>
            <span className={s.brandName}>SmartGuard</span>
          </div>
          <div className={s.footerMeta}>
            Blockchain-Enhanced AI-Powered Transaction System for Fraud Detection and Risk Analysis
            <br />
            Miva Open University Abuja · Department of Software Engineering
          </div>
        </div>
      </footer>
    </div>
  );
}
