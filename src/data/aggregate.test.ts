import { describe, expect, it } from 'vitest';
import { DAY, HOUR, OTHER_KEY, flowGroups, resolveWindow, summarize, trendByLob } from './aggregate';
import type { FlowRow } from './model';

const T0 = Date.UTC(2026, 10, 3);

const row = (over: Partial<FlowRow> = {}): FlowRow => ({
  time: T0 + 10 * HOUR,
  env: 'prod',
  lob: 'CIB',
  dataset: 'trades',
  from: 'source',
  to: 'raw',
  status: 'success',
  runs: 1,
  bytes: 100,
  records: 10,
  ...over,
});

describe('resolveWindow', () => {
  it('ends day windows at the UTC midnight after the newest event', () => {
    expect(resolveWindow('7d', T0 + 14 * HOUR)).toEqual({ start: T0 - 6 * DAY, end: T0 + DAY, bucketMs: DAY });
  });

  it('ends the 24h window at the end of the newest event hour', () => {
    expect(resolveWindow('24h', T0 + 14 * HOUR + 5)).toEqual({ start: T0 - 9 * HOUR, end: T0 + 15 * HOUR, bucketMs: HOUR });
  });
});

describe('flowGroups', () => {
  it('counts bytes from successful runs only and failures per landing layer', () => {
    const [cib] = flowGroups(
      [
        row(),
        row({ from: 'raw', to: 'trusted', bytes: 40 }),
        row({ from: 'raw', to: 'trusted', status: 'failed', runs: 2, bytes: 999 }),
      ],
      'lob',
    );
    expect(cib?.layers.raw).toMatchObject({ bytes: 100, runs: 1, failed: 0 });
    expect(cib?.layers.trusted).toMatchObject({ bytes: 40, runs: 3, failed: 2 });
    expect(cib?.links.map((l) => `${l.from}>${l.to}`)).toEqual(['source>raw', 'raw>trusted']);
  });

  it('flags a dataset as failing only while the latest run of some hop failed', () => {
    const recovered = [row({ status: 'failed' }), row({ time: T0 + 11 * HOUR })];
    const broken = [...recovered, row({ from: 'raw', to: 'trusted', status: 'failed', time: T0 + 9 * HOUR })];
    expect(summarize(recovered).failingDatasets).toBe(0);
    expect(summarize(broken).failingDatasets).toBe(1);
  });

  it('folds the smallest datasets into Other without losing volume', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row({ dataset: `d${n}`, bytes: n * 100 }));
    const groups = flowGroups(rows, 'dataset', 3);
    expect(groups.map((g) => g.label)).toEqual(['d5', 'd4', 'Other (3 datasets)']);
    expect(groups[2]).toMatchObject({ key: OTHER_KEY, datasets: 3 });
    expect(groups[2]?.layers.raw.bytes).toBe(600);
  });
});

describe('trendByLob', () => {
  it('buckets successful bytes per LOB and layer, ignoring rows outside the window', () => {
    const w = resolveWindow('7d', T0 + 10 * HOUR);
    const series = trendByLob(
      [row(), row({ time: T0 - DAY }), row({ status: 'failed' }), row({ time: w.start - 1 }), row({ lob: 'AWM', to: 'trusted', from: 'raw' })],
      w,
    );
    expect(series.map((s) => s.key)).toEqual(['AWM', 'CIB']);
    expect(series[1]?.values.raw).toEqual([0, 0, 0, 0, 0, 100, 100]);
    expect(series[0]?.values.trusted[6]).toBe(100);
  });
});
