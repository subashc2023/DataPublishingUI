import type { Summary } from '../data/aggregate';
import { ENV_LABEL, type Env } from '../data/model';
import { formatBytes, formatInteger, formatPercent } from '../format';

export interface EnvCard {
  env: Env;
  summary: Summary;
  /** Bytes landed in Raw per bucket, for the sparkline. */
  series: number[];
  /** Datasets running here whose pipeline has never run in Prod. */
  notInProd: number;
}

/**
 * The environment picker doubles as a side-by-side comparison. Each environment is its own stack;
 * the arrows between cards are pipeline-code promotion, not data movement.
 */
export function EnvironmentCards({ cards, selected, onSelect }: { cards: EnvCard[]; selected: Env; onSelect: (env: Env) => void }) {
  return (
    <fieldset className="env-strip">
      <legend className="visually-hidden">Environment</legend>
      {cards.map((card, i) => {
        const { summary } = card;
        const ok = summary.runs > 0 ? (summary.runs - summary.failed) / summary.runs : null;
        return (
          <div className="env-cell" key={card.env}>
            {i > 0 && (
              <div className="promote" aria-hidden="true">
                <span>code</span>
                <svg viewBox="0 0 28 10" width="28" height="10">
                  <path d="M0 5h25M21 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>promotion</span>
              </div>
            )}
            <label className={card.env === selected ? 'env-card selected' : 'env-card'}>
              <input type="radio" name="env" value={card.env} checked={card.env === selected} onChange={() => onSelect(card.env)} />
              <span className="env-name">{ENV_LABEL[card.env]}</span>
              <span className="env-value">{formatBytes(summary.layers.raw.bytes)}</span>
              <span className="env-sub">landed in Raw</span>
              <Sparkline values={card.series} />
              <span className="env-meta">
                {formatInteger(summary.datasets)} datasets · {ok === null ? 'no runs' : `${formatPercent(ok)} runs succeeded`}
              </span>
              {card.notInProd > 0 && (
                <span className="env-meta">
                  {card.notInProd} not yet promoted to {ENV_LABEL.prod}
                </span>
              )}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(0, ...values);
  if (values.length < 2 || max === 0) return <svg className="sparkline" aria-hidden="true" />;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - (v / max) * 20}`).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
