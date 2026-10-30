import { normalizeName, type Category, type HeritageFeature, type HeritageSiteProperties } from '@heritagetrail/shared';
import { CATEGORY_LABELS, UNESCO_LABELS } from './categories.ts';

export interface FilterState {
  query: string;
  categories: Category[];
  periods: string[];
  unescoOnly: boolean;
  includeUnverified: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  query: '',
  categories: [],
  periods: [],
  unescoOnly: false,
  includeUnverified: false,
};

export const PERIOD_UNKNOWN = 'unknown';
export const PERIOD_OTHER = 'dated-other';

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Period bucket for filtering. Only uses what the source states: the year when present, otherwise an explicit
 * "Nth century" or "NNNNs" label. Anything else with a label is "dated-other"; no period is "unknown".
 */
export function periodBucket(props: Pick<HeritageSiteProperties, 'period'>): string {
  const p = props.period;
  if (!p) return PERIOD_UNKNOWN;
  if (p.year !== null && p.year > 0) return `c${Math.floor((p.year - 1) / 100) + 1}`;
  const century = /^(\d{1,2})(st|nd|rd|th) century$/i.exec(p.label.trim());
  if (century?.[1]) return `c${Number(century[1])}`;
  const decade = /^(\d{3,4})s$/.exec(p.label.trim());
  if (decade?.[1]) return `c${Math.floor(Number(decade[1]) / 100) + 1}`;
  return PERIOD_OTHER;
}

export function periodBucketLabel(bucket: string): string {
  if (bucket === PERIOD_UNKNOWN) return 'Period unknown';
  if (bucket === PERIOD_OTHER) return 'Other dated';
  const n = Number(bucket.slice(1));
  return `${ordinal(n)} century CE`;
}

export interface PeriodOption {
  bucket: string;
  label: string;
  count: number;
}

/** Period buckets present in the data, chronological, with "Other dated" and "Period unknown" last. */
export function periodOptions(features: readonly HeritageFeature[]): PeriodOption[] {
  const counts = new Map<string, number>();
  for (const f of features) {
    const b = periodBucket(f.properties);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const rank = (b: string) => (b === PERIOD_UNKNOWN ? 10_000 : b === PERIOD_OTHER ? 9_999 : Number(b.slice(1)));
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([bucket, count]) => ({ bucket, label: periodBucketLabel(bucket), count }));
}

const haystackCache = new WeakMap<HeritageSiteProperties, string>();

function haystack(p: HeritageSiteProperties): string {
  let h = haystackCache.get(p);
  if (h === undefined) {
    const parts = [p.name, p.state, p.district ?? '', CATEGORY_LABELS[p.category], p.category, ...p.designations];
    if (p.unesco) parts.push(UNESCO_LABELS[p.unesco], 'unesco');
    if (p.asiMonumentId) parts.push(p.asiMonumentId, 'asi');
    h = ` ${normalizeName(parts.join(' '))} `;
    haystackCache.set(p, h);
  }
  return h;
}

/** Every whitespace-separated token of the query must occur in name, state, district, category or designations. */
export function matchesQuery(p: HeritageSiteProperties, query: string): boolean {
  const tokens = normalizeName(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const h = haystack(p);
  return tokens.every((t) => h.includes(t));
}

export function matchesFilters(p: HeritageSiteProperties, f: FilterState): boolean {
  if (!f.includeUnverified && p.verificationStatus !== 'verified') return false;
  if (f.categories.length > 0 && !f.categories.includes(p.category)) return false;
  if (f.unescoOnly && p.unesco === null) return false;
  if (f.periods.length > 0 && !f.periods.includes(periodBucket(p))) return false;
  return matchesQuery(p, f.query);
}

export function filterSites(features: readonly HeritageFeature[], f: FilterState): HeritageFeature[] {
  return features.filter((feat) => matchesFilters(feat.properties, f));
}

export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
