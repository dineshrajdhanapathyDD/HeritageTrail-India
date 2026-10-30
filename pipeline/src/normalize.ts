import type { CategoriesConfig, Category, OsmTagMatch, Period, SourceRef } from '@heritagetrail/shared';

export const OSM_LICENSE = 'ODbL-1.0';
export const WIKIDATA_LICENSE = 'CC0-1.0';

export interface CategoryInput {
  /** English labels of Wikidata P31 (instance of) values. */
  wikidataLabels?: readonly string[];
  /** OSM tags of the element. */
  osmTags?: Readonly<Record<string, string>>;
}

export function tagMatches(tags: Readonly<Record<string, string>>, m: OsmTagMatch): boolean {
  const value = tags[m.key];
  return value !== undefined && (m.value === '*' || value === m.value);
}

/** First rule (in config order) with a matching keyword or tag wins; otherwise the fallback. */
export function categorize(config: CategoriesConfig, input: CategoryInput): Category {
  const labels = (input.wikidataLabels ?? []).map((l) => l.toLowerCase());
  for (const rule of config.rules) {
    if (labels.some((l) => rule.wikidataLabelKeywords.some((k) => l.includes(k.toLowerCase())))) return rule.category;
    if (input.osmTags && rule.osmTags.some((m) => tagMatches(input.osmTags!, m))) return rule.category;
  }
  return config.fallback;
}

const ordinal = (n: number): string => {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

export interface WikidataTime {
  /** `wikibase:timeValue`, e.g. `1010-01-01T00:00:00Z`. */
  time: string;
  /** `wikibase:timePrecision`: 6 millennium, 7 century, 8 decade, 9 year, 10 month, 11 day. */
  precision: number;
}

export const WIKIDATA_PERIOD_SOURCE = 'Wikidata P571 (inception)';
export const OSM_PERIOD_SOURCE = 'OpenStreetMap start_date';

/**
 * Period from Wikidata inception. The value with the finest precision wins (then the earliest).
 * Labels follow the stated precision; `year` is set only for year-or-finer precision.
 * Non-positive (BCE) years are skipped because the year numbering convention could not be verified.
 */
export function periodFromWikidata(values: readonly WikidataTime[]): Period | null {
  const parsed = values
    .map((v) => ({ year: Number(/^(-?\d+)-/.exec(v.time)?.[1]), precision: v.precision }))
    .filter((v) => Number.isInteger(v.year) && v.year > 0 && v.precision >= 6)
    .sort((a, b) => b.precision - a.precision || a.year - b.year);
  const best = parsed[0];
  if (!best) return null;
  const { year, precision } = best;
  if (precision >= 9) return { label: String(year), year, source: WIKIDATA_PERIOD_SOURCE };
  if (precision === 8) return { label: `${Math.floor(year / 10) * 10}s`, year: null, source: WIKIDATA_PERIOD_SOURCE };
  if (precision === 7) return { label: `${ordinal(Math.ceil(year / 100))} century`, year: null, source: WIKIDATA_PERIOD_SOURCE };
  return { label: `${ordinal(Math.ceil(year / 1000))} millennium`, year: null, source: WIKIDATA_PERIOD_SOURCE };
}

/** Period from an OSM `start_date` tag; unrecognised formats are kept verbatim as the label. */
export function periodFromOsmStartDate(value: string | undefined): Period | null {
  const v = value?.trim();
  if (!v) return null;
  const source = OSM_PERIOD_SOURCE;
  let m = /^(\d{4})(-\d{2}(-\d{2})?)?$/.exec(v);
  if (m) return { label: String(Number(m[1])), year: Number(m[1]), source };
  m = /^C(\d{1,2})$/.exec(v);
  if (m) return { label: `${ordinal(Number(m[1]))} century`, year: null, source };
  m = /^(\d{3}0)s$/.exec(v);
  if (m) return { label: `${m[1]}s`, year: null, source };
  m = /^~\s?(\d{4})$/.exec(v);
  if (m) return { label: `c. ${Number(m[1])}`, year: null, source };
  return { label: v, year: null, source };
}

/** Record licence: ODbL when any OpenStreetMap data contributed, otherwise CC0 (Wikidata only). */
export function recordLicense(sources: readonly SourceRef[]): string {
  return sources.some((s) => s.license === OSM_LICENSE) ? OSM_LICENSE : WIKIDATA_LICENSE;
}

/** "Tiruvannamalai district" -> "Tiruvannamalai". */
export function stripDistrictSuffix(label: string): string {
  return label.replace(/\s+district$/i, '').trim();
}
