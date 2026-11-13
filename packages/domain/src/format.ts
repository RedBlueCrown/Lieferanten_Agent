import { diffDays, type IsoDate } from './dates';

/** CHF 1’166’000 — Swiss/Liechtenstein grouping with a typographic apostrophe. */
export function chf(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  if (opts.compact && Math.abs(n) >= 1_000_000) {
    return `CHF ${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} Mio.`;
  }
  return 'CHF ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’');
}

export function dateCH(d: IsoDate | null | undefined): string {
  if (!d) return '–';
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

export function relativeDays(d: IsoDate, today: IsoDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n < 0) return `seit ${-n} Tagen`;
  return `in ${n} Tagen`;
}
