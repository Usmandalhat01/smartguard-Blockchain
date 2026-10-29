import { Suspense } from 'react';
import Image from 'next/image';
import type { Metadata } from 'next';
import { Shield } from 'lucide-react';
import { DEMO_CREDENTIALS } from '@/lib/auth/accounts';
import { ROLE_LABEL } from '@/lib/auth/policy';
import { LoginClient } from './client';
import s from './login.module.css';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  // Credentials are read on the server and passed down as plain data, so the
  // client bundle never imports the account directory itself.
  const accounts = DEMO_CREDENTIALS.map((c) => ({
    email: c.email,
    password: c.password,
    role: c.role,
    label: ROLE_LABEL[c.role],
  }));

  return (
    <div className={s.page}>
      <aside className={s.artSide}>
        <Image
          src="/escrow-tracking.png"
          alt="A funded escrow moving through its stages on a phone"
          fill
          sizes="(max-width: 940px) 0px, 46vw"
          className={s.artImage}
          priority
        />
        <div className={s.artScrim} />
        <div className={s.artCopy}>
          <h2 className={s.artTitle}>Funds move when the terms are met.</h2>
          <p className={s.artText}>
            Every deposit is scored for fraud before the contract will accept it, and
            released only on confirmation and the agreed time lock.
          </p>
        </div>
      </aside>

      <div className={s.formSide}>
        <div className={s.formInner}>
          <div className={s.brand}>
            <span className={s.brandMark}><Shield size={18} /></span>
            <span className={s.brandName}>SmartGuard</span>
          </div>
          <h1 className={s.title}>Sign in</h1>
          <p className={s.subtitle}>
            Your role and its permissions are bound to your account. Each of the four roles is a
            separate sign-in and reaches only the workspace it is authorised for.
          </p>
          <Suspense fallback={null}>
            <LoginClient accounts={accounts} />
          </Suspense>
          <p className={s.foot}>
            Sessions are carried in an HttpOnly, SameSite cookie signed with a server-held key.
            The browser can neither read nor alter the role it asserts.
          </p>
        </div>
      </div>
    </div>
  );
}
