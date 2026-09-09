/**
 * Account directory — the credential side of the `User` table (Section 3.9.2).
 *
 * This is the one place that knows how a password is checked. It stands in for
 * `POST /api/v1/auth/login` on the FastAPI service; when that exists, only the
 * body of `authenticate` changes.
 *
 * Passwords here are compared against PBKDF2 hashes generated at module load
 * from the seeded demonstration credentials. They are not secret — the login
 * screen prints them — but hashing them keeps the comparison path identical to
 * the one a real directory would use, rather than a string equality check that
 * would have to be rewritten later.
 */

import 'server-only';

import { USERS } from '@/lib/seed';
import type { Role } from '@/lib/types';
import type { Principal } from './policy';

const PBKDF2_ITERATIONS = 100_000;

interface Account {
  userId: string;
  email: string;
  role: Role;
  /** hex(salt):hex(derived key) */
  passwordHash: string;
}

/* ------------------------------------------------------------- hashing -- */

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)));

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${toHex(salt)}:${toHex(await derive(password, salt))}`;
}

/** Constant-time comparison, so a wrong password cannot be found byte by byte. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const derived = await derive(password, fromHex(saltHex));
  return timingSafeEqual(derived, fromHex(keyHex));
}

/* ------------------------------------------------------------ directory -- */

/**
 * Demonstration credentials, one per role. Printed on the login screen so the
 * four workspaces can be inspected independently — which is the point: each
 * role is a separate sign-in, not a switch inside one session.
 */
export const DEMO_CREDENTIALS: { email: string; password: string; role: Role }[] = [
  { email: 'amina.yusuf@example.ng',  password: 'buyer-demo-2026',      role: 'buyer' },
  { email: 'tunde.okafor@example.ng', password: 'seller-demo-2026',     role: 'seller' },
  { email: 'n.eze@arbitration.ng',    password: 'arbitrator-demo-2026', role: 'arbitrator' },
  { email: 'operator@smartguard.ng',  password: 'admin-demo-2026',      role: 'admin' },
];

const EMAIL_TO_USER: Record<string, string> = {
  'amina.yusuf@example.ng': 'u-buyer',
  'tunde.okafor@example.ng': 'u-seller',
  'n.eze@arbitration.ng': 'u-arb',
  'operator@smartguard.ng': 'u-admin',
};

let directory: Map<string, Account> | null = null;

async function loadDirectory(): Promise<Map<string, Account>> {
  if (directory) return directory;
  const entries = await Promise.all(
    DEMO_CREDENTIALS.map(async (cred) => {
      const userId = EMAIL_TO_USER[cred.email];
      const account: Account = {
        userId,
        email: cred.email,
        role: cred.role,
        passwordHash: await hashPassword(cred.password),
      };
      return [cred.email.toLowerCase(), account] as const;
    }),
  );
  directory = new Map(entries);
  return directory;
}

/* ------------------------------------------------------ authentication -- */

export type AuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; reason: 'invalid_credentials' };

/**
 * `POST /api/v1/auth/login` in the deployed system.
 *
 * The same failure is returned for an unknown address and a wrong password, and
 * a hash is computed either way, so the response does not reveal which accounts
 * exist.
 */
export async function authenticate(email: string, password: string): Promise<AuthResult> {
  const accounts = await loadDirectory();
  const account = accounts.get(email.trim().toLowerCase());

  // Dummy verification for unknown accounts keeps the timing comparable.
  const stored = account?.passwordHash
    ?? '00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
  const passwordOk = await verifyPassword(password, stored);

  if (!account || !passwordOk) return { ok: false, reason: 'invalid_credentials' };

  const user = USERS.find((u) => u.id === account.userId);
  if (!user) return { ok: false, reason: 'invalid_credentials' };

  return {
    ok: true,
    principal: {
      userId: user.id,
      walletAddress: user.walletAddress,
      role: account.role,
      displayName: user.displayName,
    },
  };
}
