'use client';

import { useMemo, useState } from 'react';
import { Filter, ScrollText, Search } from 'lucide-react';
import { Badge, Card, Empty, ui } from '@/components/ui';
import { AuditTimeline } from '@/components/domain';
import { useStore } from '@/lib/store';
import { AUDIT_LAYER_META, type AuditLayer } from '@/lib/types';

const LAYERS: (AuditLayer | 'all')[] = ['all', 'presentation', 'application', 'oracle', 'blockchain'];

const LAYER_TONE: Record<AuditLayer, 'neutral' | 'brand' | 'chain'> = {
  presentation: 'neutral',
  application: 'brand',
  oracle: 'chain',
  blockchain: 'chain',
};

export function AuditLog() {
  const { audit } = useStore();
  const [layer, setLayer] = useState<AuditLayer | 'all'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return audit.filter((e) => {
      if (layer !== 'all' && e.layer !== layer) return false;
      if (!q) return true;
      return (
        e.eventType.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.transactionId?.toLowerCase().includes(q) ?? false) ||
        (e.txHash?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [audit, layer, query]);

  const counts = audit.reduce<Record<string, number>>((acc, e) => {
    acc[e.layer] = (acc[e.layer] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>Audit log</h1>
          <p className={ui.pageSub}>
            Every significant event, on chain and off, in one chronological record (FR-09, NFR-06).
            The generic event shape is what allows a blockchain write and an AI inference to be
            reconstructed side by side.
          </p>
        </div>
      </div>

      <Card
        title={`${filtered.length} of ${audit.length} events`}
        actions={
          <div className={ui.row} style={{ gap: 8 }}>
            <label className={ui.row} style={{ gap: 6 }}>
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <span className={ui.srOnly}>Search events</span>
              <input
                className={ui.input}
                style={{ height: 32, width: 200, fontSize: '0.8125rem' }}
                placeholder="Escrow id, hash, event…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className={ui.row} style={{ gap: 6 }}>
              <Filter size={14} style={{ color: 'var(--text-dim)' }} />
              <span className={ui.srOnly}>Filter by layer</span>
              <select
                className={ui.select}
                style={{ width: 'auto', height: 32, padding: '0 32px 0 10px', fontSize: '0.8125rem' }}
                value={layer}
                onChange={(e) => setLayer(e.target.value as AuditLayer | 'all')}
              >
                {LAYERS.map((l) => (
                  <option key={l} value={l}>
                    {l === 'all'
                      ? `All layers (${audit.length})`
                      : `${AUDIT_LAYER_META[l].label} (${counts[l] ?? 0})`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <Empty icon={<ScrollText size={19} />} title="No matching events">
            Nothing in the log matches this filter.
          </Empty>
        ) : (
          <>
            {layer !== 'all' && (
              <div style={{ marginBottom: 14 }}>
                <Badge tone={LAYER_TONE[layer]}>{AUDIT_LAYER_META[layer].label}</Badge>
              </div>
            )}
            <AuditTimeline entries={filtered} limit={120} />
          </>
        )}
      </Card>
    </>
  );
}
