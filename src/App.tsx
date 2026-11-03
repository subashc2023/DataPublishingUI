import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DatasetTable } from './components/DatasetTable';
import { EnvironmentCards, type EnvCard } from './components/EnvironmentCards';
import { FlowDiagram } from './components/FlowDiagram';
import { StatTiles } from './components/StatTiles';
import { TrendPanels } from './components/TrendPanels';
import {
  WINDOW_PRESETS,
  bucketCount,
  deployments,
  flowGroups,
  inScope,
  priorWindow,
  resolveWindow,
  summarize,
  timeRange,
  trendByLob,
  type FlowGroup,
  type WindowPreset,
} from './data/aggregate';
import { ENVS, ENV_LABEL, type Env, type FlowRow } from './data/model';
import { parseFlowExport, toCsv, type RowError } from './data/parse';
import { sampleRows } from './data/sample';
import { formatInteger, formatStamp } from './format';

/** Categorical slots in the palette; LOBs past this share the neutral "other" colour. */
const SERIES_SLOTS = 8;
const MAX_DATASET_LANES = 12;

interface Loaded {
  rows: FlowRow[];
  /** File name, or null for the built-in synthetic sample. */
  source: string | null;
  rejected: RowError[];
}

type Theme = 'light' | 'dark';

export function App() {
  const [data, setData] = useState<Loaded>(() => ({ rows: sampleRows(), source: null, rejected: [] }));
  const [env, setEnv] = useState<Env>('prod');
  const [preset, setPreset] = useState<WindowPreset>('7d');
  const [lob, setLob] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const fileInput = useRef<HTMLInputElement>(null);

  const { rows } = data;
  const range = useMemo(() => timeRange(rows), [rows]);
  const lobs = useMemo(() => [...new Set(rows.map((r) => r.lob))].sort((a, b) => a.localeCompare(b)), [rows]);
  // Colour follows the LOB's position in the full dataset, never its rank in the current filter.
  const colorOf = useMemo(() => {
    const slot = new Map(lobs.map((name, i) => [name, i]));
    return (name: string) => {
      const i = slot.get(name);
      return i !== undefined && i < SERIES_SLOTS ? `var(--series-${i + 1})` : 'var(--series-other)';
    };
  }, [lobs]);
  const activeLob = lob !== null && lobs.includes(lob) ? lob : undefined;
  const timeWindow = useMemo(() => resolveWindow(preset, range.last), [preset, range.last]);
  const windowLabel = WINDOW_PRESETS.find((p) => p.id === preset)?.label ?? preset;

  const scoped = useMemo(() => rows.filter((r) => inScope(r, { window: timeWindow, env, lob: activeLob })), [rows, timeWindow, env, activeLob]);
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const priorRaw = useMemo(() => {
    const prior = priorWindow(timeWindow);
    if (range.first > prior.start) return null;
    return summarize(rows.filter((r) => inScope(r, { window: prior, env, lob: activeLob }))).layers.raw.bytes;
  }, [rows, range.first, timeWindow, env, activeLob]);
  const lanes = useMemo(
    () => (activeLob ? flowGroups(scoped, 'dataset', MAX_DATASET_LANES) : flowGroups(scoped, 'lob')),
    [scoped, activeLob],
  );
  const datasets = useMemo(() => flowGroups(scoped, 'dataset'), [scoped]);
  const trend = useMemo(() => trendByLob(scoped, timeWindow), [scoped, timeWindow]);
  const deployed = useMemo(() => deployments(rows), [rows]);
  const envCards = useMemo(
    (): EnvCard[] =>
      ENVS.map((e) => {
        const envRows = rows.filter((r) => inScope(r, { window: timeWindow, env: e, lob: activeLob }));
        const series = new Array<number>(bucketCount(timeWindow)).fill(0);
        for (const s of trendByLob(envRows, timeWindow)) s.values.raw.forEach((v, i) => (series[i] = (series[i] ?? 0) + v));
        let notInProd = 0;
        if (e !== 'prod') {
          for (const d of deployed.values()) {
            if (d.envs.has(e) && !d.envs.has('prod') && (activeLob === undefined || d.lob === activeLob)) notInProd++;
          }
        }
        return { env: e, summary: summarize(envRows), series, notInProd };
      }),
    [rows, timeWindow, activeLob, deployed],
  );

  const loadFile = async (file: File) => {
    try {
      const result = parseFlowExport(await file.text());
      const first = result.errors[0];
      if (result.rows.length === 0) {
        setImportError(`${file.name} has no usable rows.${first ? ` Row ${first.row}: ${first.message}.` : ''}`);
        return;
      }
      setData({ rows: result.rows, source: file.name, rejected: result.errors });
      setImportError(null);
    } catch (e) {
      setImportError(`${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([toCsv(sampleRows(Date.now(), 2))], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow-events-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  };

  const drillInto = (g: FlowGroup) => setLob(g.lob);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" className="mark">
            <path d="M3 6h7v20H3zM13 10h7v12h-7zM23 13.5h6v5h-6z" />
          </svg>
          <div>
            <h1>Data Publishing Flows</h1>
            <p>How data moves Raw → Trusted → Refined, per line of business and environment</p>
          </div>
        </div>
        <div className="actions">
          <span className={data.source === null ? 'source-chip sample' : 'source-chip'}>
            {data.source === null ? 'Synthetic sample data' : `${data.source} · ${formatInteger(rows.length)} rows`}
          </span>
          <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
            Load Splunk export
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void loadFile(file);
            }}
          />
          {data.source === null ? (
            <button type="button" onClick={downloadSample}>
              Sample CSV
            </button>
          ) : (
            <button type="button" onClick={() => setData({ rows: sampleRows(), source: null, rejected: [] })}>
              Back to sample
            </button>
          )}
          <button type="button" className="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {importError !== null && (
        <div className="banner critical" role="alert">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {data.rejected.length > 0 && (
        <details className="banner">
          <summary>
            {formatInteger(data.rejected.length)} of {formatInteger(data.rejected.length + rows.length)} rows in {data.source} were rejected
            and are not shown
          </summary>
          <ul>
            {data.rejected.slice(0, 50).map((err) => (
              <li key={err.row}>
                Row {err.row}: {err.message}
              </li>
            ))}
          </ul>
          {data.rejected.length > 50 && <p className="muted">…and {formatInteger(data.rejected.length - 50)} more.</p>}
        </details>
      )}

      <div className="filters">
        <fieldset className="segmented">
          <legend className="visually-hidden">Time window</legend>
          {WINDOW_PRESETS.map((p) => (
            <label key={p.id} className={p.id === preset ? 'on' : undefined}>
              <input type="radio" name="window" value={p.id} checked={p.id === preset} onChange={() => setPreset(p.id)} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <label className="select">
          <span className="visually-hidden">Line of business</span>
          <select value={activeLob ?? ''} onChange={(e) => setLob(e.target.value === '' ? null : e.target.value)}>
            <option value="">All lines of business</option>
            {lobs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted window-range">
          {formatStamp(timeWindow.start)} – {formatStamp(timeWindow.end)}
        </span>
      </div>

      <EnvironmentCards cards={envCards} selected={env} onSelect={setEnv} />

      <StatTiles summary={summary} priorRaw={priorRaw} windowLabel={windowLabel} />

      <section className="card">
        <div className="card-head">
          <div>
            <h2>
              {activeLob ? (
                <>
                  <button type="button" className="crumb" onClick={() => setLob(null)}>
                    All lines of business
                  </button>
                  <span className="crumb-sep" aria-hidden="true">
                    /
                  </span>
                  {activeLob}
                </>
              ) : (
                'Data flow by line of business'
              )}
              <span className="env-tag">{ENV_LABEL[env]}</span>
            </h2>
            <p className="muted">
              Height is bytes landed in each layer over the last {windowLabel}. The narrowing between layers is validation,
              deduplication, compression and aggregation; Raw itself is retained.
              {activeLob ? '' : ' Select a line of business to see its datasets.'}
            </p>
          </div>
        </div>
        <FlowDiagram
          // Remount on drill so hover state from the previous lanes cannot outlive them.
          key={activeLob ?? ''}
          groups={lanes}
          colorOf={(g) => (g.lob === '' ? 'var(--series-other)' : colorOf(g.lob))}
          laneNoun={activeLob ? 'Dataset' : 'Line of business'}
          height={activeLob ? Math.max(420, 110 + lanes.length * 32) : 480}
          onSelect={activeLob ? undefined : drillInto}
        />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Volume over time</h2>
            <p className="muted">
              Bytes landed per {timeWindow.bucketMs < 86_400_000 ? 'hour' : 'day'} (UTC) in {ENV_LABEL[env]}. Each layer has its
              own scale.
            </p>
          </div>
        </div>
        <TrendPanels series={trend} window={timeWindow} dataEnd={range.last} colorOf={colorOf} />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Datasets</h2>
            <p className="muted">
              {ENV_LABEL[env]}, last {windowLabel}. “Promoted to” shows every environment the pipeline has ever run in.
            </p>
          </div>
        </div>
        <DatasetTable datasets={datasets} deployments={deployed} colorOf={colorOf} dataEnd={range.last} showLob={!activeLob} />
      </section>

      <footer className="about">
        <div>
          <h3>Layers</h3>
          <p>
            Raw, Trusted and Refined are the AWS data-lake names for what Databricks calls bronze, silver and gold. Raw keeps data as
            received so it can be replayed. Trusted is validated, typed, deduplicated and conformed. Refined is modelled for a
            purpose: aggregates, reporting and data products.
          </p>
        </div>
        <div>
          <h3>Environments</h3>
          <p>
            Dev, UAT and Prod are separate stacks, each with its own Raw → Trusted → Refined. Pipeline code is promoted from one to
            the next. Production data stays in Prod; lower environments run on masked or synthetic inputs.
          </p>
        </div>
        <div>
          <h3>Counting</h3>
          <p>
            Volume counts successful runs only; failed runs are counted separately. Windows end at the newest event in the data and
            are bucketed in UTC.
          </p>
        </div>
      </footer>
    </div>
  );
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be blocked; fall back to the OS preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
