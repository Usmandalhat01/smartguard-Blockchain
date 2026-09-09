'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle, ArrowRight, Gavel, LogIn, Settings2, ShieldCheck, User,
} from 'lucide-react';
import { Button, Field, ui } from '@/components/ui';
import type { Role } from '@/lib/types';
import s from './login.module.css';

interface DemoAccount {
  email: string;
  password: string;
  role: Role;
  label: string;
}

const ROLE_ICON: Record<Role, React.ReactNode> = {
  buyer: <User size={15} />,
  seller: <ShieldCheck size={15} />,
  arbitrator: <Gavel size={15} />,
  admin: <Settings2 size={15} />,
};

export function LoginClient({ accounts }: { accounts: DemoAccount[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string; redirectTo?: string };

      if (!response.ok) {
        setError(data.error ?? 'Sign-in failed.');
        setBusy(false);
        return;
      }

      // `next` is honoured only when it is a same-site absolute path, so a
      // crafted link cannot use the login redirect to send someone elsewhere.
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      router.replace(safeNext ?? data.redirectTo ?? '/escrows');
      router.refresh();
    } catch {
      setError('Could not reach the authentication service.');
      setBusy(false);
    }
  }

  function fillAccount(account: DemoAccount) {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  }

  return (
    <>
      <form className={s.form} onSubmit={submit}>
        {error && (
          <div className={s.error} role="alert">
            <AlertCircle size={15} style={{ flex: 'none', marginTop: 1 }} />
            {error}
          </div>
        )}

        <Field label="Email address" htmlFor="email">
          <input
            id="email"
            className={ui.input}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.ng"
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <input
            id="password"
            className={ui.input}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          <LogIn size={16} /> Sign in
        </Button>
      </form>

      <div className={s.accounts}>
        <div className={s.asideEyebrow} style={{ marginTop: 24 }}>Evaluation accounts</div>
        {accounts.map((account) => (
          <button
            key={account.email}
            type="button"
            className={s.account}
            onClick={() => fillAccount(account)}
          >
            <span className={s.accountIcon}>{ROLE_ICON[account.role]}</span>
            <span>
              <span className={s.accountRole}>{account.label}</span>
              <span className={s.accountMail}>{account.email}</span>
            </span>
            <span className={s.accountUse}>Use <ArrowRight size={11} /></span>
          </button>
        ))}
        <p className={s.asideNote}>
          Selecting an account fills the form. It does not bypass authentication — the credentials
          are still posted and verified server-side.
        </p>
      </div>
    </>
  );
}
