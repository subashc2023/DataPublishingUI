import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { bucketCount, HOUR, type TimeWindow, type TrendSeries } from '../data/aggregate';
import { LAYERS, LAYER_INFO, type Layer } from '../data/model';
import { formatBucket, formatBytes } from '../format';
import { Tooltip } from './Tooltip';
import { useElementWidth } from './useElementWidth';

const H = 188;
const M = { top: 12, right: 12, bottom: 24, left: 56 };

interface Props {
  series: TrendSeries[];
  window: TimeWindow;
  dataEnd: number;
  colorOf: (lob: string) => string;
}

/** Small multiples, one per layer, each on its own y-scale; the crosshair is shared. */
export function TrendPanels({ series, window: w, dataEnd, colorOf }: Props) {
  const [hover, setHover] = useState<{ index: number; layer: Layer } | null>(null);
  const n = bucketCount(w);
  // The newest bucket is still filling when the data stops more than an hour before it ends.
  const lastPartial = w.end - dataEnd > HOUR;

  return (
    <div>
      {series.length > 1 && (
        <ul className="legend" aria-label="Lines of business">
          {series.map((s) => (
            <li key={s.key}>
              <span className="line-key" style={{ background: colorOf(s.key) }} />
              {s.key}
            </li>
          ))}
        </ul>
      )}
      <div className="trend-grid">
        {LAYERS.map((layer) => (
          <Panel
            key={layer}
            layer={layer}
            series={series}
            n={n}
            w={w}
            lastPartial={lastPartial}
            colorOf={colorOf}
            hoverIndex={hover?.index ?? null}
            showTip={hover?.layer === layer}
            onHover={(index) => setHover(index === null ? null : { index, layer })}
          />
        ))}
      </div>
    </div>
  );
}

interface PanelProps {
  layer: Layer;
  series: TrendSeries[];
  n: number;
  w: TimeWindow;
  lastPartial: boolean;
  colorOf: (lob: string) => string;
  hoverIndex: number | null;
  showTip: boolean;
  onHover: (index: number | null) => void;
}

function Panel({ layer, series, n, w, lastPartial, colorOf, hoverIndex, showTip, onHover }: PanelProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = H - M.top - M.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values[layer]));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => M.left + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const total = series.reduce((sum, s) => sum + s.values[layer].reduce((a, b) => a + b, 0), 0);
  const xTicks = n <= 1 ? [0] : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - M.left) / (plotW || 1)) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    onHover(Math.min(n - 1, Math.max(0, (hoverIndex ?? n - 1) + step)));
  };

  const bucketLabel = (i: number) =>
    `${formatBucket(w.start + i * w.bucketMs, w.bucketMs)}${lastPartial && i === n - 1 ? ' (in progress)' : ''}`;

  return (
    <figure className="panel" ref={ref}>
      <figcaption>
        <span className="panel-title">Landed in {LAYER_INFO[layer].label}</span>
        <span className="panel-total">{formatBytes(total)}</span>
      </figcaption>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          tabIndex={0}
          role="img"
          aria-label={`Bytes landed in ${LAYER_INFO[layer].label} per ${w.bucketMs < 86_400_000 ? 'hour' : 'day'}. Use arrow keys to read values.`}
          onPointerMove={(e) => onHover(indexAt(e))}
          onPointerLeave={() => onHover(null)}
          onKeyDown={onKey}
          onFocus={() => onHover(n - 1)}
          onBlur={() => onHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="tick">
                {t === 0 ? '0' : formatBytes(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} className="tick">
              {formatBucket(w.start + i * w.bucketMs, w.bucketMs)}
            </text>
          ))}
          {series.map((s) => {
            const values = s.values[layer];
            const settled = lastPartial ? values.slice(0, -1) : values;
            return (
              <g key={s.key} style={{ stroke: colorOf(s.key) }} className="series">
                <polyline points={settled.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                {lastPartial && n > 1 && (
                  <polyline className="partial" points={`${x(n - 2)},${y(values[n - 2] ?? 0)} ${x(n - 1)},${y(values[n - 1] ?? 0)}`} />
                )}
              </g>
            );
          })}
          {hoverIndex !== null && (
            <g>
              <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={M.top} y2={M.top + plotH} className="crosshair" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hoverIndex)} cy={y(s.values[layer][hoverIndex] ?? 0)} r={4} className="hover-dot" style={{ fill: colorOf(s.key) }} />
              ))}
            </g>
          )}
        </svg>
      )}
      {showTip && hoverIndex !== null && (
        <Tooltip
          width={width}
          height={H}
          tip={{
            x: x(hoverIndex),
            y: M.top + 24,
            content: {
              title: bucketLabel(hoverIndex),
              rows: [...series]
                .sort((a, b) => (b.values[layer][hoverIndex] ?? 0) - (a.values[layer][hoverIndex] ?? 0))
                .map((s) => ({ value: formatBytes(s.values[layer][hoverIndex] ?? 0), label: s.key, color: colorOf(s.key) })),
            },
          }}
        />
      )}
    </figure>
  );
}

/** 0 plus `count` evenly spaced ticks on a 1/2/2.5/5 x 10^k step, covering `max`. */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}
