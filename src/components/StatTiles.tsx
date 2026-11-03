import type { Summary } from '../data/aggregate';
import { formatBytes, formatInteger, formatPercent } from '../format';
import { StatusIcon } from './Tooltip';

interface Props {
  summary: Summary;
  /** Raw bytes in the equal-length window just before this one; null when the data doesn't reach back. */
  priorRaw: number | null;
  windowLabel: string;
}

export function StatTiles({ summary, priorRaw, windowLabel }: Props) {
  const raw = summary.layers.raw.bytes;
  const refined = summary.layers.refined.bytes;
  const delta = priorRaw !== null && priorRaw > 0 ? raw / priorRaw - 1 : null;
  return (
    <div className="tiles">
      <div className="tile hero">
        <div className="tile-label">Landed in Raw</div>
        <div className="tile-value">{formatBytes(raw)}</div>
        <div className="tile-sub">
          {delta === null
            ? `No prior ${windowLabel} to compare`
            : `${delta >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(delta))} vs prior ${windowLabel}`}
        </div>
      </div>
      <div className="tile">
        <div className="tile-label">Published to Refined</div>
        <div className="tile-value">{formatBytes(refined)}</div>
        <div className="tile-sub">{raw > 0 ? `${formatPercent(refined / raw)} of raw volume` : 'Nothing landed in Raw'}</div>
      </div>
      <div className="tile">
        <div className="tile-label">Pipeline runs</div>
        <div className="tile-value">{formatInteger(summary.runs)}</div>
        <div className="tile-sub">
          {summary.failed > 0 ? (
            <>
              <StatusIcon kind="critical" /> {formatInteger(summary.failed)} failed ·{' '}
              {formatPercent((summary.runs - summary.failed) / summary.runs)} succeeded
            </>
          ) : (
            <>
              <StatusIcon kind="good" /> {summary.runs > 0 ? 'All succeeded' : 'No runs'}
            </>
          )}
        </div>
      </div>
      <div className="tile">
        <div className="tile-label">Datasets</div>
        <div className="tile-value">{formatInteger(summary.datasets)}</div>
        <div className="tile-sub">
          {summary.failingDatasets > 0 ? (
            <>
              <StatusIcon kind="critical" /> {summary.failingDatasets} with latest run failed
            </>
          ) : (
            <>
              <StatusIcon kind="good" /> Latest runs healthy
            </>
          )}
        </div>
      </div>
    </div>
  );
}
