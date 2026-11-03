import { describe, expect, it } from 'vitest';
import type { FlowRow } from './model';
import { parseFlowExport, toCsv } from './parse';

const row = (over: Partial<FlowRow> = {}): FlowRow => ({
  time: Date.UTC(2026, 10, 3, 14, 5),
  env: 'prod',
  lob: 'CIB',
  dataset: 'trade_executions',
  from: 'raw',
  to: 'trusted',
  status: 'success',
  runs: 1,
  bytes: 1_500_000_000,
  records: 1_200_000,
  ...over,
});

describe('parseFlowExport', () => {
  it('round-trips its own CSV, including quoted fields', () => {
    const rows = [row(), row({ lob: 'Risk, "Firmwide"', from: 'source', to: 'raw', status: 'failed', runs: 3, bytes: 0 })];
    expect(parseFlowExport(toCsv(rows))).toEqual({ rows, errors: [] });
  });

  it('reads a Splunk JSON export: one result object per line, string values, epoch-second _time', () => {
    const text = [
      '{"preview":false,"offset":0,"result":{"_time":"1793714700","env":"PROD","lob":"CIB","dataset":"trade_executions","from_layer":"raw","to_layer":"trusted","status":"success","bytes":"1500000000","records":"1200000"}}',
      '{"preview":false,"offset":1,"lastrow":true,"result":{"_time":"1793714700","env":"uat","lob":"CIB","dataset":"trade_executions","from_layer":"raw","to_layer":"trusted","status":"Failed","runs":"2","bytes":"0"}}',
    ].join('\r\n');
    const { rows, errors } = parseFlowExport(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      row({ time: 1_793_714_700_000 }),
      row({ time: 1_793_714_700_000, env: 'uat', status: 'failed', runs: 2, bytes: 0, records: 0 }),
    ]);
  });

  it('reads a REST results body with offset timestamps in either +hhmm or +hh:mm form', () => {
    const base = { env: 'prod', lob: 'CIB', dataset: 'trade_executions', from_layer: 'raw', to_layer: 'trusted', status: 'success', bytes: 1, records: 1 };
    const text = JSON.stringify({ results: [{ ...base, _time: '2026-11-03T09:05:00.000-0500' }, { ...base, time: '2026-11-03 14:05:00+00:00' }] });
    expect(parseFlowExport(text).rows.map((r) => r.time)).toEqual([Date.UTC(2026, 10, 3, 14, 5), Date.UTC(2026, 10, 3, 14, 5)]);
  });

  it('keeps valid rows and reports each rejected row with its number and reason', () => {
    const header = 'time,env,lob,dataset,from_layer,to_layer,status,bytes';
    const text = [
      header,
      '2026-11-03T14:05:00Z,prod,CIB,trades,raw,trusted,success,10',
      '2026-11-03T14:05:00,prod,CIB,trades,raw,trusted,success,10',
      '2026-11-03T14:05:00Z,qa,CIB,trades,raw,trusted,success,10',
      '2026-11-03T14:05:00Z,prod,CIB,trades,refined,trusted,success,10',
      '2026-11-03T14:05:00Z,prod,CIB,trades,raw,trusted,success,-4',
      '',
    ].join('\n');
    const { rows, errors } = parseFlowExport(text);
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(errors[0]?.message).toMatch(/offset/);
    expect(errors[1]?.message).toMatch(/env "qa"/);
    expect(errors[2]?.message).toMatch(/does not move forward/);
    expect(errors[3]?.message).toMatch(/bytes "-4"/);
  });

  it('refuses a file it cannot read rather than guessing', () => {
    expect(() => parseFlowExport('time,lob\n"2026-11-03,CIB\n')).toThrow(/quoted field/);
    expect(() => parseFlowExport('{"result":{}}\nnot json')).toThrow(/Line 2/);
  });
});
