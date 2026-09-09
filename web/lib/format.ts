/** Display helpers. Kept in one place so figures are formatted identically
 *  everywhere they appear — the report's tables and the interface should not
 *  disagree about how a number is written. */

/** 0x1234…abcd — enough to identify an address without dominating a row. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (!address) return '—';
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function shortHash(hash: string): string {
  return shortAddress(hash, 10, 8);
}

export function eth(amount: number, dp = 4): string {
  return `${amount.toFixed(dp).replace(/\.?0+$/, '')} ETH`;
}

export function pct(value: number, dp = 1): string {
  return `${(value * 100).toFixed(dp)}%`;
}

export function gas(units: number): string {
  return units.toLocaleString('en-GB');
}

const RTF = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

const DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348],
  ['month', 12],
  ['year', Infinity],
];

export function relativeTime(iso: string, now = Date.now()): string {
  let delta = (Date.parse(iso) - now) / 1000;
  for (const [unit, span] of DIVISIONS) {
    if (Math.abs(delta) < span) return RTF.format(Math.round(delta), unit);
    delta /= span;
  }
  return iso;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

export function absoluteTime(iso: string): string {
  return `${DATE_FMT.format(new Date(iso))} UTC`;
}

/** "31h 12m" — used for time locks and holding periods. */
export function duration(ms: number): string {
  if (ms <= 0) return 'elapsed';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Sepolia explorer links. Harmless while the hashes are placeholders, and
 *  correct the moment real deployment records replace them. */
export const explorer = {
  tx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  address: (addr: string) => `https://sepolia.etherscan.io/address/${addr}`,
};
