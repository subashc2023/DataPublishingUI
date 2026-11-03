import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { OTHER_KEY, type FlowGroup, type FlowLink, type Totals } from '../data/aggregate';
import { LAYERS, LAYER_INFO, SOURCE, stageIndex, type FromLayer, type Layer } from '../data/model';
import { formatBytes, formatCount, formatPercent, formatStamp } from '../format';
import { Tooltip, type TipContent, type TipState } from './Tooltip';
import { useElementWidth } from './useElementWidth';

const LABEL_W = 184;
const RIGHT_W = 120;
const HEAD_H = 72;
const NODE_W = 12;
/** Smallest visible node; tiny flows stay hoverable, and their exact values live in the table. */
const MIN_H = 3;
const MIN_WIDTH = 680;
const PARTICLE_SPEED = 70;
const MAX_PARTICLES = 14;
const PARTICLE_LANES = [-0.28, 0, 0.28];

interface Props {
  groups: FlowGroup[];
  colorOf: (group: FlowGroup) => string;
  /** Header for the lane labels, e.g. "Line of business". */
  laneNoun: string;
  height: number;
  /** Drill-in handler; omitted when the lanes cannot be opened further. */
  onSelect?: (group: FlowGroup) => void;
}

interface Node {
  y: number;
  h: number;
}

interface Ribbon {
  link: FlowLink;
  path: string;
  lanes: string[];
  seconds: number;
  thickness: number;
}

interface Lane {
  group: FlowGroup;
  /** Index 0 is the upstream-source column, then one per layer. */
  nodes: Node[];
  ribbons: Ribbon[];
  /** Vertical centres of the left (name) and right (refined) labels; right is null with nothing refined. */
  labelY: number;
  outY: number | null;
  /** Whether a label has room for its second line without meeting a neighbouring label. */
  roomyLeft: boolean;
  roomyRight: boolean;
}

/** Centre-to-centre distance two stacked two-line labels need. */
const LABEL_PITCH = 30;

/**
 * Lanes of tapered ribbons: Sources -> Raw -> Trusted -> Refined. Node height is the volume
 * landed in that layer, so a ribbon narrowing between columns is the reduction from validation,
 * deduplication, compression and aggregation. Raw data is retained, not consumed, which is why
 * this is drawn as tapering lanes rather than a flow-conserving Sankey.
 */
export function FlowDiagram({ groups, colorOf, laneNoun, height, onSelect }: Props) {
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const width = Math.max(measured, MIN_WIDTH);
  const [hover, setHover] = useState<{ key: string; tip: TipState | null } | null>(null);
  const uid = useId();

  const layout = useMemo(() => layoutLanes(groups, width, height), [groups, width, height]);
  const colTotals = useMemo(
    () => LAYERS.map((layer) => groups.reduce((sum, g) => sum + g.layers[layer].bytes, 0)),
    [groups],
  );

  if (groups.length === 0 || colTotals.every((t) => t === 0)) {
    return (
      <div ref={ref} className="flow-empty">
        No successful data movement in this scope.
      </div>
    );
  }

  const pointAt = (e: PointerEvent, key: string, content: TipContent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ key, tip: { x: e.clientX - box.left + (ref.current?.scrollLeft ?? 0), y: e.clientY - box.top, content } });
  };
  const drillable = (g: FlowGroup) => onSelect !== undefined && g.key !== OTHER_KEY;
  const onLaneKey = (e: KeyboardEvent, g: FlowGroup) => {
    if (drillable(g) && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect?.(g);
    }
  };

  return (
    <div ref={ref} className="flow" style={{ height }} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} role="group" aria-label={`Data flow by ${laneNoun.toLowerCase()}`}>
        <defs>
          {layout.lanes.map(({ group }, i) => (
            <linearGradient key={group.key} id={`${uid}-in-${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" style={{ stopColor: colorOf(group), stopOpacity: 0 }} />
              <stop offset="0.7" style={{ stopColor: colorOf(group), stopOpacity: 1 }} />
            </linearGradient>
          ))}
        </defs>
        <rect width={width} height={height} fill="transparent" onPointerMove={() => setHover(null)} />

        <g className="flow-head">
          <text x={0} y={16} className="eyebrow">
            {laneNoun}
          </text>
          <text x={layout.colX[0]} y={16} className="eyebrow">
            Sources
          </text>
          <text x={layout.colX[0]} y={33} className="col-blurb">
            Systems of record
          </text>
          {LAYERS.map((layer, i) => {
            const cx = (layout.colX[i + 1] ?? 0) + NODE_W / 2;
            return (
              <g key={layer} textAnchor="middle">
                <text x={cx} y={16} className="col-label">
                  {LAYER_INFO[layer].label}
                  <tspan className="col-medallion"> · {LAYER_INFO[layer].medallion.toLowerCase()}</tspan>
                </text>
                <text x={cx} y={33} className="col-blurb">
                  {LAYER_INFO[layer].blurb}
                </text>
                <text x={cx} y={51} className="col-total">
                  {formatBytes(colTotals[i] ?? 0)}
                </text>
              </g>
            );
          })}
        </g>

        {layout.lanes.map((lane, i) => {
          const { group } = lane;
          const color = colorOf(group);
          const dim = hover !== null && hover.key !== group.key;
          const raw = group.layers.raw.bytes;
          const last = group.layers.refined.bytes;
          const { labelY, outY, roomyLeft, roomyRight } = lane;
          return (
            <g key={group.key} className={dim ? 'lane dim' : 'lane'}>
              {lane.ribbons.map((r) => (
                <path
                  key={`${r.link.from}>${r.link.to}`}
                  d={r.path}
                  className="ribbon"
                  style={{ fill: r.link.from === SOURCE ? `url(#${uid}-in-${i})` : color }}
                  onPointerMove={(e) => pointAt(e, group.key, linkTip(group, r.link))}
                />
              ))}
              <g className="particles" aria-hidden="true">
                {lane.ribbons.flatMap((r) => particles(r, layout.maxLinkBytes, color))}
              </g>
              {LAYERS.map((layer, li) => {
                const node = lane.nodes[li + 1];
                if (!node || node.h === 0) return null;
                const x = layout.colX[li + 1] ?? 0;
                const failed = group.layers[layer].failed;
                return (
                  <g key={layer} onPointerMove={(e) => pointAt(e, group.key, nodeTip(group, layer))}>
                    <rect x={x - 4} y={node.y - 4} width={NODE_W + 8} height={node.h + 8} fill="transparent" />
                    <rect x={x} y={node.y} width={NODE_W} height={node.h} rx={Math.min(3, node.h / 2)} style={{ fill: color }} />
                    {failed > 0 && (
                      // Sits in the gap above the node, where no ribbon passes; the count reads leftwards so it
                      // never meets the right-hand lane labels.
                      <g transform={`translate(${x + 1}, ${node.y - 13})`} className="fail-mark">
                        <path d="M5 0l5 9H0z" />
                        <text x={-3} y={8.5} textAnchor="end">
                          {formatCount(failed)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
              <g
                className={drillable(group) ? 'lane-label drillable' : 'lane-label'}
                transform={`translate(0, ${labelY})`}
                tabIndex={0}
                role={drillable(group) ? 'button' : undefined}
                aria-label={`${group.label}: ${formatBytes(raw)} landed in Raw, ${formatBytes(last)} refined${drillable(group) ? '. Open datasets' : ''}`}
                onClick={() => drillable(group) && onSelect?.(group)}
                onKeyDown={(e) => onLaneKey(e, group)}
                onFocus={() => setHover({ key: group.key, tip: { x: 24, y: labelY, content: laneTip(group, drillable(group)) } })}
                onBlur={() => setHover(null)}
                onPointerMove={(e) => pointAt(e, group.key, laneTip(group, drillable(group)))}
              >
                <rect x={-4} y={-15} width={LABEL_W - 12} height={30} rx={6} className="lane-hit" />
                <circle cx={6} cy={roomyLeft ? -6 : 0} r={5} style={{ fill: color }} />
                <text x={18} y={roomyLeft ? -2 : 4} className="lane-name">
                  {truncate(group.label, 21)}
                </text>
                {roomyLeft && (
                  <text x={18} y={13} className="lane-value">
                    {formatBytes(raw)} landed
                  </text>
                )}
              </g>
              {outY !== null && (
                <g transform={`translate(${(layout.colX[LAYERS.length] ?? 0) + NODE_W + 10}, ${outY})`} className="lane-out">
                  <text y={roomyRight ? -2 : 4} className="lane-value strong">
                    {formatBytes(last)}
                  </text>
                  {roomyRight && raw > 0 && (
                    <text y={13} className="lane-value">
                      {formatPercent(last / raw)} of raw
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={hover?.tip ?? null} width={width} height={height} />
    </div>
  );
}

function layoutLanes(groups: FlowGroup[], width: number, height: number) {
  const cols = LAYERS.length + 1;
  const left = LABEL_W;
  const right = width - RIGHT_W - NODE_W;
  const colX = Array.from({ length: cols }, (_, c) => left + (c * (right - left)) / (cols - 1));
  const gap = groups.length > 6 ? 16 : 26;
  const top = HEAD_H;
  const avail = height - top - 12;

  const nodeBytes = (g: FlowGroup, col: number): number => {
    const layer = LAYERS[col - 1];
    if (layer) return g.layers[layer].bytes;
    return g.links.reduce((sum, l) => sum + (l.from === SOURCE ? l.totals.bytes : 0), 0);
  };
  const colSums = colX.map((_, c) => groups.reduce((sum, g) => sum + nodeBytes(g, c), 0));
  const scale = Math.max(0, avail - gap * (groups.length - 1) - groups.length * MIN_H) / Math.max(1, ...colSums);

  // One linear scale for every column, each column's stack centred: lanes converge as volume shrinks.
  const nodes: Node[][] = groups.map(() => []);
  colX.forEach((_, c) => {
    const heights = groups.map((g) => {
      const b = nodeBytes(g, c);
      return b > 0 ? Math.max(MIN_H, b * scale) : 0;
    });
    let y = top + (avail - heights.reduce((a, b) => a + b, 0) - gap * (groups.length - 1)) / 2;
    heights.forEach((h, gi) => {
      nodes[gi]?.push({ y, h });
      y += h + gap;
    });
  });

  let maxLinkBytes = 1;
  for (const g of groups) for (const l of g.links) maxLinkBytes = Math.max(maxLinkBytes, l.totals.bytes);

  const centre = (n: Node | undefined) => (n && n.h > 0 ? n.y + n.h / 2 : null);
  // Name labels sit on the ingest stub, or on Raw for a lane with no ingest in the window.
  const leftY = nodes.map((n) => centre(n[0]) ?? centre(n[1]) ?? top);
  const rightY = nodes.map((n) => centre(n[cols - 1]));
  const roomy = (centres: (number | null)[], i: number) =>
    centres.every((c, j) => j === i || c === null || Math.abs(c - (centres[i] ?? 0)) >= LABEL_PITCH);

  const lanes: Lane[] = groups.map((group, gi) => {
    const laneNodes = nodes[gi] ?? [];
    const outBytes = new Array<number>(cols).fill(0);
    const inBytes = new Array<number>(cols).fill(0);
    const drawn = group.links.filter((l) => l.totals.bytes > 0);
    for (const l of drawn) {
      outBytes[col(l.from)] = (outBytes[col(l.from)] ?? 0) + l.totals.bytes;
      inBytes[col(l.to)] = (inBytes[col(l.to)] ?? 0) + l.totals.bytes;
    }
    const outOffset = new Array<number>(cols).fill(0);
    const inOffset = new Array<number>(cols).fill(0);
    const ribbons = drawn.map((link): Ribbon => {
      const sc = col(link.from);
      const dc = col(link.to);
      const src = laneNodes[sc] ?? { y: 0, h: 0 };
      const dst = laneNodes[dc] ?? { y: 0, h: 0 };
      // A node feeding (or fed by) several hops splits its height between them by bytes.
      const h0 = (src.h * link.totals.bytes) / (outBytes[sc] || 1);
      const h1 = (dst.h * link.totals.bytes) / (inBytes[dc] || 1);
      const y0 = src.y + (outOffset[sc] ?? 0);
      const y1 = dst.y + (inOffset[dc] ?? 0);
      outOffset[sc] = (outOffset[sc] ?? 0) + h0;
      inOffset[dc] = (inOffset[dc] ?? 0) + h1;
      const x0 = (colX[sc] ?? 0) + (sc === 0 ? 0 : NODE_W);
      const x1 = colX[dc] ?? 0;
      return {
        link,
        path: ribbonPath(x0, y0, h0, x1, y1, h1),
        lanes: PARTICLE_LANES.map((f) => curve(x0, y0 + h0 * (0.5 + f), x1, y1 + h1 * (0.5 + f))),
        seconds: (x1 - x0) / PARTICLE_SPEED,
        thickness: Math.min(h0, h1),
      };
    });
    return {
      group,
      nodes: laneNodes,
      ribbons,
      labelY: leftY[gi] ?? top,
      outY: rightY[gi] ?? null,
      roomyLeft: roomy(leftY, gi),
      roomyRight: roomy(rightY, gi),
    };
  });

  return { colX, lanes, maxLinkBytes };
}

function col(stage: FromLayer): number {
  return stageIndex(stage) + 1;
}

function ribbonPath(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h1}C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0}Z`;
}

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`;
}

/** Particle count grows with the square root of volume so small flows still visibly move. */
function particles(r: Ribbon, maxLinkBytes: number, color: string) {
  const count = Math.max(1, Math.round(MAX_PARTICLES * Math.sqrt(r.link.totals.bytes / maxLinkBytes)));
  const radius = Math.min(2.4, Math.max(1, r.thickness * 0.22));
  return Array.from({ length: count }, (_, i) => (
    <circle key={`${r.link.from}>${r.link.to}:${i}`} r={radius} style={{ fill: color }}>
      <animateMotion
        dur={`${r.seconds.toFixed(2)}s`}
        begin={`${(-(i * r.seconds) / count).toFixed(2)}s`}
        repeatCount="indefinite"
        path={r.lanes[i % r.lanes.length]}
      />
    </circle>
  ));
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function runRows(t: Totals): TipContent['rows'] {
  const rows: TipContent['rows'] = [{ value: formatCount(t.runs), label: t.runs === 1 ? 'run' : 'runs' }];
  if (t.failed > 0) rows.push({ value: formatCount(t.failed), label: 'failed', critical: true });
  return rows;
}

function laneTip(g: FlowGroup, drillable: boolean): TipContent {
  const rows: TipContent['rows'] = LAYERS.map((layer) => ({ value: formatBytes(g.layers[layer].bytes), label: LAYER_INFO[layer].label }));
  rows.push({ value: formatCount(g.datasets), label: g.datasets === 1 ? 'dataset' : 'datasets' });
  if (g.failingDatasets > 0) rows.push({ value: formatCount(g.failingDatasets), label: 'latest run failed', critical: true });
  return { title: g.label, rows, note: drillable ? 'Click to see its datasets' : undefined };
}

function nodeTip(g: FlowGroup, layer: Layer): TipContent {
  const t = g.layers[layer];
  return {
    title: `${g.label} · landed in ${LAYER_INFO[layer].label}`,
    rows: [{ value: formatBytes(t.bytes), label: 'written' }, { value: formatCount(t.records), label: 'records' }, ...runRows(t)],
    note: t.lastSuccess !== null ? `Last success ${formatStamp(t.lastSuccess)}` : 'No successful run in this window',
  };
}

function linkTip(g: FlowGroup, link: FlowLink): TipContent {
  const from = link.from === SOURCE ? 'Sources' : LAYER_INFO[link.from].label;
  const rows: TipContent['rows'] = [{ value: formatBytes(link.totals.bytes), label: `written to ${LAYER_INFO[link.to].label}` }];
  if (link.from !== SOURCE && g.layers[link.from].bytes > 0) {
    rows.push({ value: formatPercent(link.totals.bytes / g.layers[link.from].bytes), label: `of ${from} volume` });
  }
  return { title: `${g.label} · ${from} → ${LAYER_INFO[link.to].label}`, rows: [...rows, ...runRows(link.totals)] };
}
