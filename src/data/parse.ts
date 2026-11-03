import { ENVS, LAYERS, SOURCE, stageIndex, type Env, type FlowRow, type FromLayer, type Layer } from './model';

export interface RowError {
  /** 1-based data row (CSV header and blank lines excluded). */
  row: number;
  message: string;
}

export interface ParseResult {
  rows: FlowRow[];
  errors: RowError[];
}

export const CSV_COLUMNS = ['time', 'env', 'lob', 'dataset', 'from_layer', 'to_layer', 'status', 'runs', 'bytes', 'records'];

/**
 * Reads a Splunk CSV export, a Splunk JSON export (one `{"result": {...}}` object per line), a REST
 * `{"results": [...]}` body, or a plain JSON array. Throws only when the file itself is unreadable;
 * individual bad rows are reported in `errors` and skipped.
 */
export function parseFlowExport(text: string): ParseResult {
  const body = text.replace(/^\uFEFF/, '').trim();
  const items = body === '' ? [] : body.startsWith('[') || body.startsWith('{') ? readJson(body) : readCsv(body);
  const rows: FlowRow[] = [];
  const errors: RowError[] = [];
  items.forEach((item, i) => {
    const result = toRow(item);
    if (typeof result === 'string') errors.push({ row: i + 1, message: result });
    else rows.push(result);
  });
  return { rows, errors };
}

export function toCsv(rows: FlowRow[]): string {
  const lines = rows.map((r) =>
    [new Date(r.time).toISOString(), r.env, r.lob, r.dataset, r.from, r.to, r.status, r.runs, r.bytes, r.records]
      .map((v) => csvField(String(v)))
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...lines].join('\n') + '\n';
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function readJson(body: string): unknown[] {
  let whole: unknown;
  try {
    whole = JSON.parse(body);
  } catch {
    // Not one JSON document, so it must be newline-delimited (Splunk's export format).
    return body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, i) => {
        try {
          return unwrapSplunkResult(JSON.parse(line));
        } catch {
          throw new Error(`Line ${i + 1} is not valid JSON.`);
        }
      });
  }
  if (Array.isArray(whole)) return whole.map(unwrapSplunkResult);
  if (isObject(whole) && Array.isArray(whole.results)) return whole.results;
  return [unwrapSplunkResult(whole)];
}

function unwrapSplunkResult(item: unknown): unknown {
  return isObject(item) && isObject(item.result) ? item.result : item;
}

function readCsv(body: string): Record<string, string>[] {
  const [header, ...data] = csvRows(body);
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return data
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ''])));
}

/** RFC 4180: quoted fields may contain commas, doubled quotes and line breaks. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c !== '"') field += c;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('The CSV ends inside a quoted field.');
  row.push(field);
  rows.push(row);
  return rows;
}

function toRow(item: unknown): FlowRow | string {
  if (!isObject(item)) return 'row is not an object';
  const rawTime = item.time ?? item._time;
  const time = parseTime(rawTime);
  if (time === null) return `time ${show(rawTime)} is not epoch seconds/ms or an ISO-8601 timestamp with an offset`;
  const env = text(item.env).toLowerCase();
  if (!isEnv(env)) return `env ${show(item.env)} must be one of ${ENVS.join(', ')}`;
  const lob = text(item.lob);
  if (lob === '') return 'lob is empty';
  const dataset = text(item.dataset);
  if (dataset === '') return 'dataset is empty';
  const from = text(item.from_layer).toLowerCase();
  if (!isFromLayer(from)) return `from_layer ${show(item.from_layer)} must be one of ${[SOURCE, ...LAYERS].join(', ')}`;
  const to = text(item.to_layer).toLowerCase();
  if (!isLayer(to)) return `to_layer ${show(item.to_layer)} must be one of ${LAYERS.join(', ')}`;
  if (stageIndex(from) >= stageIndex(to)) return `hop ${from} -> ${to} does not move forward through the layers`;
  const status = text(item.status).toLowerCase();
  if (status !== 'success' && status !== 'failed') return `status ${show(item.status)} must be success or failed`;
  const bytes = number(item.bytes);
  if (bytes === null || bytes < 0) return `bytes ${show(item.bytes)} must be a non-negative number`;
  const records = isBlank(item.records) ? 0 : number(item.records);
  if (records === null || records < 0) return `records ${show(item.records)} must be a non-negative number`;
  const runs = isBlank(item.runs) ? 1 : number(item.runs);
  if (runs === null || runs < 1 || !Number.isInteger(runs)) return `runs ${show(item.runs)} must be a whole number >= 1`;
  return { time, env, lob, dataset, from, to, status, runs, bytes, records };
}

/**
 * Epoch values below 1e11 are seconds (Splunk's `_time`), larger ones milliseconds. Strings need an
 * explicit offset so a timestamp never silently shifts by the viewer's local timezone.
 */
function parseTime(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) value = Number(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value < 1e11 ? value * 1000 : value);
  }
  if (typeof value !== 'string') return null;
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!iso) return null;
  const [, date, clock, zone = ''] = iso;
  const offset = zone === 'Z' ? zone : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const ms = Date.parse(`${date}T${clock}${offset}`);
  return Number.isNaN(ms) ? null : ms;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function number(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function show(value: unknown): string {
  return value === undefined ? '(missing)' : JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnv(value: string): value is Env {
  return (ENVS as readonly string[]).includes(value);
}

function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value);
}

function isFromLayer(value: string): value is FromLayer {
  return value === SOURCE || isLayer(value);
}
