const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

/** Decimal units (1 TB = 10^12 bytes), the convention storage and Splunk volume reports use. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (unit < BYTE_UNITS.length - 1 && Math.abs(value) >= 999.5) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || Math.abs(value) >= 99.95 ? 0 : Math.abs(value) >= 9.995 ? 1 : 2;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCount = (n: number): string => compact.format(n);

const whole = new Intl.NumberFormat('en-US');
export const formatInteger = (n: number): string => whole.format(n);

/**
 * A ratio as a percentage. Values near 0% and 100% keep a decimal so that a rate with any failures
 * never reads as 100%, and a non-zero share never reads as 0%.
 */
export function formatPercent(ratio: number): string {
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  if (pct > 99.9 && pct < 100) return '>99.9%';
  return `${pct.toFixed(pct !== 0 && (pct < 10 || pct > 99) && pct !== 100 ? 1 : 0)}%`;
}

export function formatAgo(time: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const utcDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const utcHour = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const utcStamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** Bucket labels are UTC to match the UTC bucketing in aggregate.ts. */
export function formatBucket(time: number, bucketMs: number): string {
  return bucketMs < 86_400_000 ? utcHour.format(time) : utcDay.format(time);
}

export const formatStamp = (time: number): string => `${utcStamp.format(time)} UTC`;
