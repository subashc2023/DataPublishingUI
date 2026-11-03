import { LAYERS, datasetKey, layerRecord, stageIndex, type Env, type FlowRow, type FromLayer, type Layer } from './model';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export type WindowPreset = '24h' | '7d' | '30d';
export const WINDOW_PRESETS: { id: WindowPreset; label: string }[] = [
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
];

/** Half-open [start, end) in epoch ms, split into UTC buckets of `bucketMs`. */
export interface TimeWindow {
  start: number;
  end: number;
  bucketMs: number;
}

/**
 * Windows end at the newest event rather than the wall clock, so an export pulled last week still
 * shows its own last N days. Buckets are whole UTC hours (24h) or UTC days.
 */
export function resolveWindow(preset: WindowPreset, dataEnd: number): TimeWindow {
  if (preset === '24h') {
    const end = Math.floor(dataEnd / HOUR) * HOUR + HOUR;
    return { start: end - DAY, end, bucketMs: HOUR };
  }
  const end = Math.floor(dataEnd / DAY) * DAY + DAY;
  return { start: end - (preset === '7d' ? 7 : 30) * DAY, end, bucketMs: DAY };
}

export function priorWindow(w: TimeWindow): TimeWindow {
  return { start: 2 * w.start - w.end, end: w.start, bucketMs: w.bucketMs };
}

export function bucketCount(w: TimeWindow): number {
  return Math.round((w.end - w.start) / w.bucketMs);
}

export interface Scope {
  window: TimeWindow;
  env?: Env;
  lob?: string;
}

export function inScope(row: FlowRow, scope: Scope): boolean {
  return (
    row.time >= scope.window.start &&
    row.time < scope.window.end &&
    (scope.env === undefined || row.env === scope.env) &&
    (scope.lob === undefined || row.lob === scope.lob)
  );
}

export interface Totals {
  bytes: number;
  records: number;
  runs: number;
  failed: number;
  lastSuccess: number | null;
}

export const emptyTotals = (): Totals => ({ bytes: 0, records: 0, runs: 0, failed: 0, lastSuccess: null });

/** Volume counts successful runs only: a failed run adds to `failed`, never to bytes or records. */
function addRow(t: Totals, row: FlowRow): void {
  t.runs += row.runs;
  if (row.status === 'failed') {
    t.failed += row.runs;
    return;
  }
  t.bytes += row.bytes;
  t.records += row.records;
  t.lastSuccess = Math.max(t.lastSuccess ?? row.time, row.time);
}

function mergeInto(t: Totals, other: Totals): void {
  t.bytes += other.bytes;
  t.records += other.records;
  t.runs += other.runs;
  t.failed += other.failed;
  if (other.lastSuccess !== null) t.lastSuccess = Math.max(t.lastSuccess ?? other.lastSuccess, other.lastSuccess);
}

export interface FlowLink {
  from: FromLayer;
  to: Layer;
  totals: Totals;
}

export interface FlowGroup {
  key: string;
  label: string;
  /** Owning LOB; empty for the folded "Other" group. */
  lob: string;
  datasets: number;
  /** Datasets whose most recent run of any hop failed. */
  failingDatasets: number;
  /** What landed in each layer, from the hops writing into it. */
  layers: Record<Layer, Totals>;
  links: FlowLink[];
}

export const OTHER_KEY = '\u0000other';

/**
 * Groups rows into one flow per LOB or per dataset. LOB groups are alphabetical so lane order and
 * colour stay put across filters; dataset groups are sorted by volume, and past `maxGroups` the
 * tail folds into one "Other" group.
 */
export function flowGroups(rows: FlowRow[], by: 'lob' | 'dataset', maxGroups = Infinity): FlowGroup[] {
  interface Acc {
    group: FlowGroup;
    links: Map<string, FlowLink>;
    datasets: Set<string>;
    latestHop: Map<string, { time: number; failed: boolean }>;
  }
  const accs = new Map<string, Acc>();
  for (const row of rows) {
    const key = by === 'lob' ? row.lob : datasetKey(row);
    let acc = accs.get(key);
    if (!acc) {
      const group: FlowGroup = {
        key,
        label: by === 'lob' ? row.lob : row.dataset,
        lob: row.lob,
        datasets: 0,
        failingDatasets: 0,
        layers: layerRecord(emptyTotals),
        links: [],
      };
      acc = { group, links: new Map(), datasets: new Set(), latestHop: new Map() };
      accs.set(key, acc);
    }
    addRow(acc.group.layers[row.to], row);
    const linkKey = `${row.from}>${row.to}`;
    let link = acc.links.get(linkKey);
    if (!link) {
      link = { from: row.from, to: row.to, totals: emptyTotals() };
      acc.links.set(linkKey, link);
    }
    addRow(link.totals, row);
    const ds = datasetKey(row);
    acc.datasets.add(ds);
    const hopKey = `${ds}|${linkKey}`;
    const prev = acc.latestHop.get(hopKey);
    // On a timestamp tie the failure wins, so a dataset is never reported healthier than it is.
    if (!prev || row.time > prev.time || (row.time === prev.time && row.status === 'failed')) {
      acc.latestHop.set(hopKey, { time: row.time, failed: row.status === 'failed' });
    }
  }

  const groups = [...accs.values()].map(({ group, links, datasets, latestHop }) => {
    const failing = new Set<string>();
    for (const [hopKey, latest] of latestHop) if (latest.failed) failing.add(hopKey.slice(0, hopKey.indexOf('|')));
    return { ...group, datasets: datasets.size, failingDatasets: failing.size, links: sortLinks([...links.values()]) };
  });

  if (by === 'lob') return groups.sort((a, b) => a.key.localeCompare(b.key));
  groups.sort((a, b) => totalBytes(b) - totalBytes(a) || a.key.localeCompare(b.key));
  if (groups.length <= maxGroups) return groups;
  const kept = groups.slice(0, Math.max(0, maxGroups - 1));
  return [...kept, foldOther(groups.slice(kept.length))];
}

function foldOther(tail: FlowGroup[]): FlowGroup {
  const other: FlowGroup = {
    key: OTHER_KEY,
    label: `Other (${tail.length} datasets)`,
    lob: '',
    datasets: 0,
    failingDatasets: 0,
    layers: layerRecord(emptyTotals),
    links: [],
  };
  const links = new Map<string, FlowLink>();
  for (const g of tail) {
    other.datasets += g.datasets;
    other.failingDatasets += g.failingDatasets;
    for (const layer of LAYERS) mergeInto(other.layers[layer], g.layers[layer]);
    for (const link of g.links) {
      const key = `${link.from}>${link.to}`;
      let merged = links.get(key);
      if (!merged) {
        merged = { from: link.from, to: link.to, totals: emptyTotals() };
        links.set(key, merged);
      }
      mergeInto(merged.totals, link.totals);
    }
  }
  return { ...other, links: sortLinks([...links.values()]) };
}

function sortLinks(links: FlowLink[]): FlowLink[] {
  return links.sort((a, b) => stageIndex(a.from) - stageIndex(b.from) || stageIndex(a.to) - stageIndex(b.to));
}

function totalBytes(g: FlowGroup): number {
  return LAYERS.reduce((sum, layer) => sum + g.layers[layer].bytes, 0);
}

export interface Summary {
  layers: Record<Layer, Totals>;
  runs: number;
  failed: number;
  datasets: number;
  failingDatasets: number;
}

export function summarize(rows: FlowRow[]): Summary {
  const summary: Summary = { layers: layerRecord(emptyTotals), runs: 0, failed: 0, datasets: 0, failingDatasets: 0 };
  for (const g of flowGroups(rows, 'dataset')) {
    summary.datasets += g.datasets;
    summary.failingDatasets += g.failingDatasets;
    for (const layer of LAYERS) mergeInto(summary.layers[layer], g.layers[layer]);
  }
  for (const layer of LAYERS) {
    summary.runs += summary.layers[layer].runs;
    summary.failed += summary.layers[layer].failed;
  }
  return summary;
}

export interface TrendSeries {
  key: string;
  /** Successful bytes landed per bucket, per layer. */
  values: Record<Layer, number[]>;
}

/** One series per LOB; rows already narrowed to a single LOB give a single series. */
export function trendByLob(rows: FlowRow[], w: TimeWindow): TrendSeries[] {
  const n = bucketCount(w);
  const series = new Map<string, TrendSeries>();
  for (const row of rows) {
    if (row.status !== 'success' || row.time < w.start || row.time >= w.end) continue;
    let s = series.get(row.lob);
    if (!s) {
      s = { key: row.lob, values: layerRecord(() => new Array<number>(n).fill(0)) };
      series.set(row.lob, s);
    }
    const i = Math.floor((row.time - w.start) / w.bucketMs);
    s.values[row.to][i] = (s.values[row.to][i] ?? 0) + row.bytes;
  }
  return [...series.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface Deployment {
  lob: string;
  envs: Set<Env>;
}

/** Which environments each dataset has ever run in, i.e. how far its pipeline has been promoted. */
export function deployments(rows: FlowRow[]): Map<string, Deployment> {
  const map = new Map<string, Deployment>();
  for (const row of rows) {
    const key = datasetKey(row);
    let d = map.get(key);
    if (!d) {
      d = { lob: row.lob, envs: new Set() };
      map.set(key, d);
    }
    d.envs.add(row.env);
  }
  return map;
}

export function timeRange(rows: FlowRow[]): { first: number; last: number } {
  let first = Infinity;
  let last = -Infinity;
  for (const row of rows) {
    first = Math.min(first, row.time);
    last = Math.max(last, row.time);
  }
  return { first, last };
}
