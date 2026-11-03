export interface TipRow {
  value: string;
  label: string;
  /** Series colour for a short line key; omitted for plain rows. */
  color?: string;
  critical?: boolean;
}

export interface TipContent {
  title: string;
  rows: TipRow[];
  note?: string;
}

export interface TipState {
  /** Position relative to the positioned container. */
  x: number;
  y: number;
  content: TipContent;
}

/** Values lead and labels follow: the reader already knows the series and wants the number. */
export function Tooltip({ tip, width, height }: { tip: TipState | null; width: number; height: number }) {
  if (!tip) return null;
  const dx = tip.x > width - 260 ? 'calc(-100% - 14px)' : '14px';
  const dy = tip.y > height - 150 ? 'calc(-100% - 14px)' : '14px';
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y, transform: `translate(${dx}, ${dy})` }} role="status">
      <div className="tooltip-title">{tip.content.title}</div>
      {tip.content.rows.map((row) => (
        <div className="tooltip-row" key={row.label}>
          {row.color !== undefined && <span className="line-key" style={{ background: row.color }} />}
          {row.critical && <StatusIcon kind="critical" />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
      {tip.content.note !== undefined && <div className="tooltip-note">{tip.content.note}</div>}
    </div>
  );
}

/** Status colour never carries meaning alone: every use sits beside a text label. */
export function StatusIcon({ kind }: { kind: 'good' | 'critical' }) {
  return kind === 'good' ? (
    <svg className="status-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="var(--status-good)" />
      <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="status-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l7 12.5H1z" fill="var(--status-critical)" strokeLinejoin="round" />
      <path d="M8 6v3.6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.95" fill="#fff" />
    </svg>
  );
}
