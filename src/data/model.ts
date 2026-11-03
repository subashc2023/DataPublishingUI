/**
 * The contract between Splunk and the UI. Each row is one pipeline hop that wrote data into a
 * layer: `source -> raw` is ingestion, `raw -> trusted` and `trusted -> refined` are refinement.
 * Changing the platform's layer names means editing LAYERS; the compiler then points at every
 * per-layer record that needs the new key.
 */
export const LAYERS = ['raw', 'trusted', 'refined'] as const;
export type Layer = (typeof LAYERS)[number];

/** `from_layer` value for data arriving from an upstream system of record. */
export const SOURCE = 'source';
export type FromLayer = Layer | typeof SOURCE;

export const LAYER_INFO: Record<Layer, { label: string; blurb: string; medallion: string }> = {
  raw: { label: 'Raw', blurb: 'Landed as received', medallion: 'Bronze' },
  trusted: { label: 'Trusted', blurb: 'Validated & conformed', medallion: 'Silver' },
  refined: { label: 'Refined', blurb: 'Business-ready products', medallion: 'Gold' },
};

/** Environments are isolated stacks: pipeline code is promoted dev -> uat -> prod, data is not. */
export const ENVS = ['dev', 'uat', 'prod'] as const;
export type Env = (typeof ENVS)[number];
export const ENV_LABEL: Record<Env, string> = { dev: 'Dev', uat: 'UAT', prod: 'Prod' };

export type Status = 'success' | 'failed';

export interface FlowRow {
  /** Epoch milliseconds. */
  time: number;
  env: Env;
  lob: string;
  dataset: string;
  from: FromLayer;
  to: Layer;
  status: Status;
  /** Runs folded into this row; > 1 when Splunk pre-aggregates with `stats count AS runs`. */
  runs: number;
  /** Bytes written into `to`. */
  bytes: number;
  records: number;
}

export function layerRecord<T>(make: () => T): Record<Layer, T> {
  return { raw: make(), trusted: make(), refined: make() };
}

/** Position in the flow; SOURCE sits before the first layer. */
export function stageIndex(stage: FromLayer): number {
  return stage === SOURCE ? -1 : LAYERS.indexOf(stage);
}

export function datasetKey(row: { lob: string; dataset: string }): string {
  return `${row.lob}/${row.dataset}`;
}
