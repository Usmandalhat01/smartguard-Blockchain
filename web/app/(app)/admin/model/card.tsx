'use client';

import { AlertTriangle, Database, FlaskConical, Layers, Split } from 'lucide-react';
import { Badge, Card, KeyValue, Notice, Stat, StatGrid, ui } from '@/components/ui';
import { ProvenanceChip } from '@/components/domain';
import { FEATURE_SET, PROVENANCE_META, REPORTED_IMPORTANCE, featureLabel } from '@/lib/features';
import { useStore } from '@/lib/store';
import a from '../admin.module.css';

/** Table 3.5 — the documented 70:15:15 partition of the 6,362,620 PaySim records. */
const PARTITIONS = [
  { name: 'Full PaySim dataset',   share: '100%', legit: 6_354_407, fraud: 8_213,     note: 'López-Rojas et al. (2016)' },
  { name: 'Training (pre-SMOTE)',  share: '70%',  legit: 4_448_085, fraud: 5_749,     note: 'Only partition SMOTE is applied to' },
  { name: 'Training (post-SMOTE)', share: '—',    legit: 4_448_085, fraud: 4_448_085, note: 'Balanced by feature-space interpolation' },
  { name: 'Validation',            share: '15%',  legit: 953_161,   fraud: 1_232,     note: 'Natural class distribution retained' },
  { name: 'Held-out test',         share: '15%',  legit: 953_161,   fraud: 1_232,     note: 'Never seen during fitting' },
];

export function ModelCard() {
  const { settings } = useStore();

  const counts = FEATURE_SET.reduce<Record<string, number>>((acc, f) => {
    acc[f.provenance] = (acc[f.provenance] ?? 0) + 1;
    return acc;
  }, {});

  const maxImportance = Math.max(...REPORTED_IMPORTANCE.map((i) => i.importance));

  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.pageTitle}>Model &amp; features</h1>
          <p className={ui.pageSub}>
            What the risk score is computed from, how the training data was partitioned, and which
            parts of that record are documented rather than verified.
          </p>
        </div>
        <Badge tone="brand">{settings.modelVersion}</Badge>
      </div>

      <div className={ui.stack}>
        <Notice tone="danger" title="Reported classification metrics are not shown here" icon={<AlertTriangle size={15} />}>
          This page deliberately omits accuracy, precision, recall, F1 and ROC-AUC figures for the
          model. Chapter Four records that the confusion matrix, prediction files and split indices
          behind the previously reported values were not retained, so those numbers cannot be
          presented as findings. They belong here once the pipeline has been rerun from one
          documented split with saved predictions.
        </Notice>

        <StatGrid>
          <Stat label="Features" value={FEATURE_SET.length} icon={<Layers size={13} />} tone="brand" foot="Table 3.4 vector" />
          <Stat label="From PaySim" value={counts.original ?? 0} icon={<Database size={13} />} tone="chain" foot="Original variables" />
          <Stat label="Derived" value={counts.derived ?? 0} icon={<Split size={13} />} tone="brand" foot="Computed in preprocessing" />
          <Stat label="Simulated proxies" value={counts.simulated ?? 0} icon={<FlaskConical size={13} />} tone="elevated" foot="Generation record not retained" />
        </StatGrid>

        <div className={ui.split}>
          <Card title="Feature set" subtitle="Table 3.4, with provenance category and construction rule." flush>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Feature</th>
                    <th>Provenance</th>
                    <th>Construction rule</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_SET.map((f) => (
                    <tr key={f.key}>
                      <td className="tnum" style={{ color: 'var(--text-muted)' }}>{f.index}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{f.label}</div>
                        <code className={`mono ${a.featureKey}`}>{f.key}</code>
                      </td>
                      <td><ProvenanceChip provenance={f.provenance} /></td>
                      <td style={{ fontSize: '0.8125rem', lineHeight: 1.5, minWidth: 280 }}>
                        {f.rule}
                        {f.caveat && <div className={a.featureCaveat}>{f.caveat}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className={ui.stack}>
            <Card title="Configuration" subtitle="As recorded in Appendix A.">
              <KeyValue rows={[
                ['Algorithm', 'Random Forest'],
                ['Trees', <span key="a" className="tnum">200</span>],
                ['Maximum depth', <span key="b" className="tnum">18</span>],
                ['Min samples per leaf', <span key="c" className="tnum">4</span>],
                ['Selection criterion', 'Five-fold CV F1 (fraud class)'],
                ['Random seed', <Badge key="d" tone="blocked">Not retained</Badge>],
                ['Parameter grid', <Badge key="e" tone="blocked">Not retained</Badge>],
                ['Model checksum', <Badge key="f" tone="blocked">Not retained</Badge>],
              ]} />
            </Card>

            <Card title="Provenance key">
              <div className={ui.stackSm}>
                {(Object.keys(PROVENANCE_META) as (keyof typeof PROVENANCE_META)[]).map((p) => (
                  <div key={p} className={a.provRow}>
                    <ProvenanceChip provenance={p} />
                    <div>
                      <div className={a.provLabel}>{PROVENANCE_META[p].label}</div>
                      <div className={a.provNote}>{PROVENANCE_META[p].note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              title="Reported feature importance"
              subtitle="Figure 4.4 Gini ranking. Descriptive — the serialised model and training log were not retained."
            >
              <div className={ui.stackSm}>
                {REPORTED_IMPORTANCE.map((row) => (
                  <div key={row.key}>
                    <div className={a.importanceRow}>
                      <span style={{ color: 'var(--text)' }}>{featureLabel(row.key)}</span>
                      <span className="tnum" style={{ color: 'var(--text-dim)' }}>{row.importance.toFixed(3)}</span>
                    </div>
                    <div className={a.importanceTrack}>
                      <div className={a.importanceFill} style={{ width: `${(row.importance / maxImportance) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <Card
          title="Dataset partition"
          subtitle="Table 3.5. SMOTE is applied to the training partition only, after the split, so no synthetic record reaches validation or test."
          flush
        >
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Partition</th>
                  <th>Share</th>
                  <th className={ui.tdRight}>Legitimate</th>
                  <th className={ui.tdRight}>Fraudulent</th>
                  <th className={ui.tdRight}>Total</th>
                  <th className={ui.tdRight}>Fraud ratio</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {PARTITIONS.map((p) => {
                  const total = p.legit + p.fraud;
                  return (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</td>
                      <td className="tnum">{p.share}</td>
                      <td className={`${ui.tdRight} tnum`}>{p.legit.toLocaleString('en-GB')}</td>
                      <td className={`${ui.tdRight} tnum`}>{p.fraud.toLocaleString('en-GB')}</td>
                      <td className={`${ui.tdRight} tnum`} style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {total.toLocaleString('en-GB')}
                      </td>
                      <td className={`${ui.tdRight} tnum`}>{((p.fraud / total) * 100).toFixed(3)}%</td>
                      <td style={{ fontSize: '0.8125rem' }}>{p.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
