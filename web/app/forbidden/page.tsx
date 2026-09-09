import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, ShieldX } from 'lucide-react';
import { getPrincipal } from '@/lib/auth/server';
import { ROLE_LABEL, ROLE_PERMISSIONS, homeFor } from '@/lib/auth/policy';
import { Button } from '@/components/ui';
import s from './forbidden.module.css';

export const metadata: Metadata = { title: 'Not authorised' };

export default async function ForbiddenPage({
  searchParams,
}: { searchParams: Promise<{ permission?: string; to?: string }> }) {
  const { permission, to } = await searchParams;
  const principal = await getPrincipal();

  // Only same-site absolute paths are followed, so the query string cannot be
  // used to bounce someone off to another origin.
  const safeTo = to && to.startsWith('/') && !to.startsWith('//') ? to : null;
  const home = safeTo ?? (principal ? homeFor(principal.role) : '/login');

  return (
    <div className={s.page}>
      <div className={s.card}>
        <span className={s.icon}><ShieldX size={24} /></span>

        <h1 className={s.title}>Not authorised</h1>
        <p className={s.body}>
          {principal
            ? <>Your account is signed in as <strong>{ROLE_LABEL[principal.role]}</strong>, which does not hold the permission this page requires.</>
            : <>This page requires a permission your session does not hold.</>}
        </p>

        {permission && (
          <div className={s.detail}>
            <span className={s.detailLabel}>Required permission</span>
            <code className={s.detailValue}>{permission}</code>
          </div>
        )}

        {principal && (
          <div className={s.grants}>
            <span className={s.grantsLabel}>Permissions on your account</span>
            <div className={s.grantList}>
              {ROLE_PERMISSIONS[principal.role].map((granted) => (
                <code key={granted} className={s.grant}>{granted}</code>
              ))}
            </div>
          </div>
        )}

        <p className={s.note}>
          Access is decided by the role bound to your account, not by the interface. Requesting the
          address directly produces this same result.
        </p>

        <Link href={home}>
          <Button variant="primary">
            Return to your workspace <ArrowRight size={15} />
          </Button>
        </Link>
      </div>
    </div>
  );
}
