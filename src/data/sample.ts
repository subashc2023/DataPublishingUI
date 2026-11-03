import { DAY, HOUR } from './aggregate';
import { ENVS, SOURCE, type Env, type FlowRow, type FromLayer, type Layer } from './model';

/*
 * Synthetic pipeline history so the UI runs without a Splunk export. Dataset names are generic
 * banking domains and every volume is invented; nothing here describes a real platform.
 */

interface Spec {
  lob: string;
  dataset: string;
  /** Prod GB landed in Raw on a weekday. */
  rawGB: number;
  cadence: 'hourly' | 'daily';
  /** Bytes written to Trusted / Refined as a share of Raw. */
  trusted: number;
  refined: number;
  /** Saturday/Sunday volume multiplier (default 0.7). */
  weekend?: number;
  /** Days ago the pipeline was first deployed to each environment; omitted = deployed everywhere. */
  since?: Partial<Record<Env, number>>;
}

const SPECS: Spec[] = [
  { lob: 'AWM', dataset: 'portfolio_holdings', rawGB: 1800, cadence: 'daily', trusted: 0.55, refined: 0.3 },
  { lob: 'AWM', dataset: 'client_accounts', rawGB: 600, cadence: 'daily', trusted: 0.5, refined: 0.25 },
  { lob: 'AWM', dataset: 'fund_nav_pricing', rawGB: 250, cadence: 'daily', trusted: 0.6, refined: 0.4, weekend: 0.2 },
  { lob: 'AWM', dataset: 'advisor_activity', rawGB: 900, cadence: 'hourly', trusted: 0.45, refined: 0.15, weekend: 0.3 },
  { lob: 'AWM', dataset: 'esg_scores', rawGB: 120, cadence: 'daily', trusted: 0.6, refined: 0.35, since: { dev: 12 } },
  { lob: 'CCB', dataset: 'card_transactions', rawGB: 5200, cadence: 'hourly', trusted: 0.42, refined: 0.18, weekend: 1.05 },
  { lob: 'CCB', dataset: 'digital_clickstream', rawGB: 14000, cadence: 'hourly', trusted: 0.3, refined: 0.06, weekend: 1.1 },
  { lob: 'CCB', dataset: 'deposit_accounts', rawGB: 1400, cadence: 'daily', trusted: 0.5, refined: 0.3 },
  { lob: 'CCB', dataset: 'mortgage_servicing', rawGB: 800, cadence: 'daily', trusted: 0.55, refined: 0.3 },
  { lob: 'CCB', dataset: 'auto_loans', rawGB: 350, cadence: 'daily', trusted: 0.55, refined: 0.3 },
  { lob: 'CCB', dataset: 'fraud_signals', rawGB: 2600, cadence: 'hourly', trusted: 0.38, refined: 0.12, weekend: 1 },
  { lob: 'CCB', dataset: 'realtime_offers', rawGB: 900, cadence: 'hourly', trusted: 0.35, refined: 0.1, since: { dev: 26, uat: 9 } },
  { lob: 'CIB', dataset: 'market_data_ticks', rawGB: 26000, cadence: 'hourly', trusted: 0.28, refined: 0.04, weekend: 0.08 },
  { lob: 'CIB', dataset: 'trade_executions', rawGB: 3100, cadence: 'hourly', trusted: 0.5, refined: 0.22, weekend: 0.1 },
  { lob: 'CIB', dataset: 'payments_iso20022', rawGB: 6400, cadence: 'hourly', trusted: 0.4, refined: 0.15, weekend: 0.45 },
  { lob: 'CIB', dataset: 'securities_positions', rawGB: 2200, cadence: 'daily', trusted: 0.55, refined: 0.3, weekend: 0.3 },
  { lob: 'CIB', dataset: 'credit_exposure', rawGB: 1100, cadence: 'daily', trusted: 0.6, refined: 0.35 },
  { lob: 'CIB', dataset: 'client_onboarding_kyc', rawGB: 300, cadence: 'daily', trusted: 0.5, refined: 0.25, weekend: 0.2 },
  { lob: 'CIB', dataset: 'settlement_instructions', rawGB: 1500, cadence: 'hourly', trusted: 0.45, refined: 0.2, weekend: 0.2 },
  { lob: 'Corporate', dataset: 'general_ledger', rawGB: 1200, cadence: 'daily', trusted: 0.6, refined: 0.4, weekend: 0.3 },
  { lob: 'Corporate', dataset: 'treasury_liquidity', rawGB: 700, cadence: 'hourly', trusted: 0.5, refined: 0.3, weekend: 0.3 },
  { lob: 'Corporate', dataset: 'regulatory_capital', rawGB: 400, cadence: 'daily', trusted: 0.65, refined: 0.45 },
  { lob: 'Corporate', dataset: 'firmwide_risk_aggregates', rawGB: 1600, cadence: 'daily', trusted: 0.55, refined: 0.35 },
  { lob: 'Corporate', dataset: 'vendor_spend', rawGB: 60, cadence: 'daily', trusted: 0.6, refined: 0.4, weekend: 0.1 },
];

/** Lower environments run smaller (masked or synthetic) inputs, less often, and fail more. */
const ENV_PROFILE: Record<Env, { scale: number; failRate: number; everyHours: number }> = {
  dev: { scale: 0.008, failRate: 0.06, everyHours: 4 },
  uat: { scale: 0.06, failRate: 0.02, everyHours: 1 },
  prod: { scale: 1, failRate: 0.004, everyHours: 1 },
};

/** Windows where every attempt at one hop fails, so the demo has recent incidents to show. */
const INCIDENTS: { dataset: string; env: Env; to: Layer; hoursAgo: number; hours: number }[] = [
  { dataset: 'settlement_instructions', env: 'prod', to: 'trusted', hoursAgo: 53, hours: 4 },
  { dataset: 'credit_exposure', env: 'prod', to: 'refined', hoursAgo: 30, hours: 31 },
  { dataset: 'card_transactions', env: 'uat', to: 'trusted', hoursAgo: 6, hours: 7 },
];

const HOPS: { from: FromLayer; to: Layer; delayMin: number }[] = [
  { from: SOURCE, to: 'raw', delayMin: 0 },
  { from: 'raw', to: 'trusted', delayMin: 14 },
  { from: 'trusted', to: 'refined', delayMin: 33 },
];

const BYTES_PER_RAW_RECORD = 850;

/** Hour-of-day weights (UTC) peaking around US market hours, normalised to a mean of 1. */
const DIURNAL = (() => {
  const w = Array.from({ length: 24 }, (_, h) => 0.35 + Math.exp(-((h - 17) ** 2) / 18));
  const mean = w.reduce((a, b) => a + b, 0) / 24;
  return w.map((x) => x / mean);
})();

export function sampleRows(now = Date.now(), days = 60): FlowRow[] {
  const today = Math.floor(now / DAY) * DAY;
  const firstDay = today - (days - 1) * DAY;
  const rows: FlowRow[] = [];
  for (const spec of SPECS) {
    const batchHour = 1 + (hash(spec.dataset) % 5);
    for (const env of ENVS) {
      const sinceDays = spec.since ? spec.since[env] : days;
      if (sinceDays === undefined) continue;
      const profile = ENV_PROFILE[env];
      const rand = mulberry32(hash(`${spec.dataset}|${env}`));
      const step = spec.cadence === 'hourly' ? profile.everyHours * HOUR : DAY;
      const first = Math.max(firstDay, today - sinceDays * DAY) + (spec.cadence === 'daily' ? batchHour * HOUR : 0);
      for (let t = first; t <= now; t += step) {
        const date = new Date(t);
        const dow = date.getUTCDay();
        const weekend = dow === 0 || dow === 6 ? (spec.weekend ?? 0.7) : 1;
        const share = spec.cadence === 'daily' ? 1 : hourShare(date.getUTCHours(), profile.everyHours);
        const growth = 1 + 0.1 * ((t - firstDay) / (days * DAY));
        const rawBytes = spec.rawGB * 1e9 * profile.scale * share * weekend * growth * (0.85 + 0.3 * rand());
        emitRun(rows, spec, env, t, rawBytes, rand, now);
      }
    }
  }
  return rows;
}

function emitRun(rows: FlowRow[], spec: Spec, env: Env, start: number, rawBytes: number, rand: () => number, now: number) {
  const rawRecords = rawBytes / BYTES_PER_RAW_RECORD;
  const slow = spec.cadence === 'daily' ? 3 : 1;
  for (const hop of HOPS) {
    const time = Math.round(start + (hop.delayMin * slow + rand() * 4) * 60_000);
    if (time > now) return;
    const jitter = 0.95 + 0.1 * rand();
    const bytes = hop.to === 'raw' ? rawBytes : rawBytes * (hop.to === 'trusted' ? spec.trusted : spec.refined) * jitter;
    const records =
      hop.to === 'raw' ? rawRecords : rawRecords * 0.97 * (hop.to === 'refined' ? Math.min(1, spec.refined / spec.trusted) : 1);
    const failed = inIncident(spec.dataset, env, hop.to, time, now) || rand() < ENV_PROFILE[env].failRate;
    rows.push({
      time,
      env,
      lob: spec.lob,
      dataset: spec.dataset,
      from: hop.from,
      to: hop.to,
      status: failed ? 'failed' : 'success',
      runs: 1,
      bytes: failed ? 0 : Math.round(bytes),
      records: failed ? 0 : Math.round(records),
    });
    // A failed hop leaves nothing for the next hop to read.
    if (failed) return;
  }
}

function inIncident(dataset: string, env: Env, to: Layer, time: number, now: number): boolean {
  return INCIDENTS.some(
    (i) => i.dataset === dataset && i.env === env && i.to === to && time >= now - i.hoursAgo * HOUR && time < now - (i.hoursAgo - i.hours) * HOUR,
  );
}

/** Share of a day's volume that lands in the `hours` starting at `hour`. */
function hourShare(hour: number, hours: number): number {
  let sum = 0;
  for (let h = hour; h < hour + hours; h++) sum += DIURNAL[h % 24] ?? 1;
  return sum / 24;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
