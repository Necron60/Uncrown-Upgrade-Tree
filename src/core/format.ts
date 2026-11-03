const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Compact, readable number formatting: 950, 9.5K, 12.3M, 1.00e36 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const neg = n < 0;
  n = Math.abs(n);
  let out: string;
  if (n < 1000) {
    out = n < 10 && n % 1 !== 0 ? (Math.floor(n * 10) / 10).toString() : Math.floor(n).toString();
  } else {
    const tier = Math.floor(Math.log10(n) / 3);
    if (tier >= SUFFIXES.length) {
      out = n.toExponential(2).replace('+', '');
    } else {
      const scaled = n / Math.pow(1000, tier);
      const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
      // floor (not round) so we never display more than the player actually has
      const f = Math.pow(10, digits);
      out = (Math.floor(scaled * f) / f).toFixed(digits) + SUFFIXES[tier];
    }
  }
  return neg ? '-' + out : out;
}

export function fmtPct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtTime(seconds: number): string {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
