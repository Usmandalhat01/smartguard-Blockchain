'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight, Boxes, Check, Cpu, Gauge, Gavel, Link2, Lock, LogIn,
  Monitor, Moon, ScrollText, Settings2, Shield, ShieldCheck, Sun, User,
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
  { icon: <Boxes size={15} />, name: 'Blockchain layer', tech: 'Solidity 0.8.20 · Sepolia', colour: 'var(--chain)', edge: null },
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

/**
 * The three things a person actually does with SmartGuard, in the order they
 * do them. Each is illustrated rather than described, because the landing page
 * is read by people deciding whether to trust the thing, not only by examiners.
 */
const CAPABILITIES = [
  {
    image: '/escrow-agreement.png',
    alt: 'A seller reviewing and signing escrow terms on a tablet',
    eyebrow: 'Step one',
    title: 'Agree the terms before any money moves',
    body:
      'Buyer, seller and arbitrator are fixed the moment an escrow opens, and the '
      + 'identifier is derived from the terms themselves. Nobody can quietly swap a '
      + 'party or an amount afterwards.',
    points: [
      'Three named parties, settled up front',
      'Identifier derived from the agreed terms',
      'Arbitrator chosen before there is a dispute',
    ],
  },
  {
    image: '/escrow-tracking.png',
    alt: 'A buyer tracking a funded escrow moving through its stages on a phone',
    eyebrow: 'Step two',
    title: 'Fund it once the risk check clears',
    body:
      'Every deposit is scored before it is accepted. The score is written on chain '
      + 'and the contract reads it back itself, so a high-risk deposit is refused at '
      + 'the point of custody rather than flagged for someone to chase.',
    points: [
      'Eighteen signals scored in under two seconds',
      'Refused above the configured gate',
      'An unscored deposit is refused, not waved through',
    ],
  },
  {
    image: '/escrow-global.png',
    alt: 'Cross-border settlement, currencies orbiting a secured wallet',
    eyebrow: 'Step three',
    title: 'Release on the terms, not on trust',
    body:
      'Funds sit in the contract until delivery is confirmed and the time lock runs '
      + 'out. If something goes wrong, either side can raise a dispute and the '
      + 'arbitrator decides — not the buyer, and not the seller.',
    points: [
      'Held in the contract, not by an intermediary',
      'Released on confirmation and a 48-hour lock',
      'Disputes resolved by the named arbitrator',
    ],
  },
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
          <span className={s.eyebrow}>
            <Shield size={12} /> Escrow with a risk check the contract enforces
          </span>

          <h1 className={s.title}>
            Send money to a stranger{' '}
            <span className={s.titleAccent}>without trusting one.</span>
          </h1>

          <p className={s.lede}>
            SmartGuard holds the funds in a smart contract and scores the transaction for
            fraud before it will accept them. The score is not a warning someone has to act
            on — it is a condition the contract checks itself, every time.
          </p>

          <div className={s.heroCtas}>
            <Link href="/login">
              <Button variant="primary" size="lg"><LogIn size={16} /> Sign in</Button>
            </Link>
            <Link href="#how">
              <Button size="lg">See how it works</Button>
            </Link>
          </div>
        </div>

        <div className={s.heroShot}>
          <div className={s.shotFrame}>
            <Image
              src="/escrow-hero.png"
              alt="A buyer and a seller either side of a secured escrow agreement"
              width={1668}
              height={461}
              priority
              sizes="(max-width: 1200px) 100vw, 1140px"
              className={s.shotImage}
            />
          </div>
        </div>

        <div className={s.heroMeta}>
          <div>
            <div className={s.metaValue}>4</div>
            <div className={s.metaLabel}>architectural layers</div>
          </div>
          <div>
            <div className={s.metaValue}>18</div>
            <div className={s.metaLabel}>signals scored per deposit</div>
          </div>
          <div>
            <div className={s.metaValue}>6.36M</div>
            <div className={s.metaLabel}>transactions trained on</div>
          </div>
          <div>
            <div className={s.metaValue}>48h</div>
            <div className={s.metaLabel}>release time lock</div>
          </div>
        </div>
      </section>

      <section className={s.section} id="product">
        <div className={s.sectionInner}>
          <div className={s.sectionEyebrow}>How an escrow runs</div>
          <h2 className={s.sectionTitle}>Three steps, and the contract holds the line at each one</h2>
          <p className={s.sectionLede}>
            Nothing here depends on either party behaving well, or on anyone watching a
            dashboard. Each stage has a rule, and the rule is enforced where the money is.
          </p>

          <div className={s.capGrid}>
            {CAPABILITIES.map((cap) => (
              <article key={cap.title} className={s.capCard}>
                <div className={s.capMedia}>
                  <Image
                    src={cap.image}
                    alt={cap.alt}
                    width={556}
                    height={465}
                    sizes="(max-width: 900px) 100vw, 380px"
                    className={s.capImage}
                  />
                </div>
                <div className={s.capBody}>
                  <span className={s.capEyebrow}>{cap.eyebrow}</span>
                  <h3 className={s.capTitle}>{cap.title}</h3>
                  <p className={s.capText}>{cap.body}</p>
                  <ul className={s.capList}>
                    {cap.points.map((point) => (
                      <li key={point} className={s.capItem}>
                        <Check size={13} className={s.capTick} />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${s.section} ${s.sectionAlt}`} id="architecture">
        <div className={s.sectionInner}>
          <div className={s.archGrid}>
            <div>
              <div className={s.sectionEyebrow}>Architecture</div>
              <h2 className={s.sectionTitle}>Four layers, one request path</h2>
              <p className={s.sectionLede}>
                A deposit travels from the browser to the model, from the model to the
                chain through an oracle, and is finally judged by the contract that holds
                the funds. Each boundary is a separate process, so no layer can quietly
                assume another one did its job.
              </p>
            </div>

            <div className={s.diagram}>
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
        </div>
      </section>

      <section className={s.section} id="how">
        <div className={s.sectionInner}>
          <div className={s.sectionEyebrow}>Why it holds</div>
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

      <section className={`${s.section} ${s.sectionAlt}`}>
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

      <footer className={s.footer}>
        <div className={s.footerInner}>
          <div className={s.brand}>
            <span className={s.brandMark}><Shield size={17} /></span>
            <span className={s.brandName}>SmartGuard</span>
          </div>
          <div className={s.footerMeta}>
            Blockchain-Enhanced AI-Powered Digital Escrow Transaction System for Fraud Detection and Risk Analysis
            <br />
            Miva Open University Abuja · Department of Software Engineering
          </div>
        </div>
      </footer>
    </div>
  );
}
