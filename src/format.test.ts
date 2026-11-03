import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent } from './format';

describe('formatPercent', () => {
  it('never shows a rate with failures as 100%, or a non-zero share as 0%', () => {
    expect(formatPercent(575 / 576)).toBe('99.8%');
    expect(formatPercent(0.99999)).toBe('>99.9%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.0004)).toBe('<0.1%');
    expect(formatPercent(0.05)).toBe('5.0%');
    expect(formatPercent(0.27)).toBe('27%');
  });
});

describe('formatBytes', () => {
  it('uses decimal units and rolls over before printing a four-digit value', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(999.6)).toBe('1.00 KB');
    expect(formatBytes(1.5e12)).toBe('1.50 TB');
    expect(formatBytes(23.6e12)).toBe('23.6 TB');
    expect(formatBytes(464e12)).toBe('464 TB');
  });
});
