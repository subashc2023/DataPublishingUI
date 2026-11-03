import { useMemo, useState } from 'react';
import type { Deployment, FlowGroup } from '../data/aggregate';
import { ENVS, ENV_LABEL, LAYERS, LAYER_INFO, type Layer } from '../data/model';
import { formatAgo, formatBytes, formatInteger, formatPercent, formatStamp } from '../format';
import { StatusIcon } from './Tooltip';

type SortKey = 'dataset' | Layer | 'kept' | 'runs' | 'failed' | 'last';

interface Props {
  datasets: FlowGroup[];
  deployments: Map<string, Deployment>;
  colorOf: (lob: string) => string;
  dataEnd: number;
  showLob: boolean;
}

interface Row {
  group: FlowGroup;
  kept: number | null;
  runs: number;
  failed: number;
  last: number | null;
}

/** The table view of the flow: every value the diagram encodes, readable without hovering. */
export function DatasetTable({ datasets, deployments, colorOf, dataEnd, showLob }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'raw', desc: true });
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: Row[] = datasets
      .filter((g) => q === '' || g.label.toLowerCase().includes(q) || g.lob.toLowerCase().includes(q))
      .map((group) => {
        const layers = LAYERS.map((l) => group.layers[l]);
        return {
          group,
          kept: group.layers.raw.bytes > 0 ? group.layers.refined.bytes / group.layers.raw.bytes : null,
          runs: layers.reduce((s, t) => s + t.runs, 0),
          failed: layers.reduce((s, t) => s + t.failed, 0),
          // Freshness of what consumers read: an upstream hop succeeding doesn't make Refined current.
          last: group.layers.refined.lastSuccess,
        };
      });
    const value = (r: Row): number | string => {
      switch (sort.key) {
        case 'dataset':
          return r.group.label;
        case 'kept':
          return r.kept ?? -1;
        case 'runs':
          return r.runs;
        case 'failed':
          return r.failed;
        case 'last':
          return r.last ?? 0;
        default:
          return r.group.layers[sort.key].bytes;
      }
    };
    return all.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
      return sort.desc ? -cmp : cmp;
    });
  }, [datasets, query, sort]);

  const header = (key: SortKey, label: string, numeric = true) => (
    <th key={key} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={numeric ? 'num' : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'dataset' }))}>
        {label}
        <span className="sort-mark" aria-hidden="true">
          {sort.key === key ? (sort.desc ? '↓' : '↑') : ''}
        </span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="table-tools">
        <input type="search" placeholder="Filter datasets" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter datasets" />
        <span className="muted">
          {rows.length} of {datasets.length} datasets
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {header('dataset', 'Dataset', false)}
              <th>Promoted to</th>
              <th>Latest run</th>
              {LAYERS.map((l) => header(l, LAYER_INFO[l].label))}
              {header('kept', 'Refined / Raw')}
              {header('runs', 'Runs')}
              {header('failed', 'Failed')}
              {header('last', 'Refined updated')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ group, kept, runs, failed, last }) => {
              const envs = deployments.get(group.key)?.envs;
              return (
                <tr key={group.key}>
                  <td>
                    <span className="dataset-cell">
                      <span className="swatch" style={{ background: colorOf(group.lob) }} />
                      <span>{group.label}</span>
                      {showLob && <span className="muted">{group.lob}</span>}
                    </span>
                  </td>
                  <td>
                    <span className="env-chips" aria-label={`Deployed in ${ENVS.filter((e) => envs?.has(e)).map((e) => ENV_LABEL[e]).join(', ')}`}>
                      {ENVS.map((e) => (
                        <span key={e} className={envs?.has(e) ? 'chip on' : 'chip'} aria-hidden="true">
                          {ENV_LABEL[e]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    <span className="status-cell">
                      <StatusIcon kind={group.failingDatasets > 0 ? 'critical' : 'good'} />
                      {group.failingDatasets > 0 ? 'Failed' : 'Succeeded'}
                    </span>
                  </td>
                  {LAYERS.map((l) => (
                    <td key={l} className="num">
                      {formatBytes(group.layers[l].bytes)}
                    </td>
                  ))}
                  <td className="num">{kept === null ? '—' : formatPercent(kept)}</td>
                  <td className="num">{formatInteger(runs)}</td>
                  <td className="num">{failed > 0 ? formatInteger(failed) : '—'}</td>
                  <td className="num" title={last === null ? undefined : formatStamp(last)}>
                    {last === null ? 'None in window' : formatAgo(last, dataEnd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
