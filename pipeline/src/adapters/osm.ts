import type { CategoriesConfig, OsmTagMatch, OverpassTagFilter, SourceConfig, StateConfig } from '@heritagetrail/shared';
import { osmId, type OsmElementType } from '@heritagetrail/shared';
import type { RawFetchRequest } from '../rawStore.ts';
import { compareStrings } from '../rawStore.ts';
import { categorize, periodFromOsmStartDate } from '../normalize.ts';
import { fetchJson, type CandidateRecord, type SourceAdapter } from './types.ts';

type OverpassConfig = NonNullable<SourceConfig['overpass']>;

export interface OverpassElement {
  type: OsmElementType;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tag clause for one filter; excluded values of required keys are filtered out in the query itself. */
function filterClause(f: OverpassTagFilter, exclude: readonly OsmTagMatch[]): string {
  let clause = `[${quote(f.key)}=${quote(f.value)}]`;
  for (const key of f.requireKeys) {
    clause += `[${quote(key)}]`;
    const values = exclude.filter((e) => e.key === key).map((e) => escapeRegex(e.value));
    if (values.length > 0) clause += `[${quote(key)}!~${quote(`^(${values.join('|')})$`)}]`;
  }
  return clause;
}

export function buildOverpassQuery(state: StateConfig, cfg: OverpassConfig): string {
  const lines = cfg.tagFilters.map((f) => `  nwr${filterClause(f, cfg.excludeTags)}(area.searchArea);`);
  return `[out:json][timeout:${cfg.timeoutSeconds}];
area[${quote('ISO3166-2')}=${quote(state.osmIso)}]->.searchArea;
(
${lines.join('\n')}
);
out center tags;
`;
}

export function buildOverpassRequest(source: SourceConfig, state: StateConfig): RawFetchRequest {
  if (!source.overpass) throw new Error(`${source.id}: overpass settings missing in config/sources.json`);
  return {
    source: source.id,
    name: 'sites',
    url: source.endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ data: buildOverpassQuery(state, source.overpass) }).toString(),
  };
}

/** Same rule as the query: an element matches a filter unless a required key carries an excluded value. */
export function matchesFilters(tags: Readonly<Record<string, string>>, cfg: OverpassConfig): boolean {
  return cfg.tagFilters.some(
    (f) =>
      tags[f.key] === f.value &&
      f.requireKeys.every((k) => tags[k] !== undefined && !cfg.excludeTags.some((e) => e.key === k && e.value === tags[k])),
  );
}

export function elementPosition(el: OverpassElement): [number, number] | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return [el.lon, el.lat];
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') return [el.center.lon, el.center.lat];
  return null;
}

export function osmName(tags: Readonly<Record<string, string>>): string | null {
  const name = (tags['name:en'] ?? tags.name)?.trim();
  return name ? name : null;
}

export function osmWikidataTag(tags: Readonly<Record<string, string>>): string | null {
  const first = tags.wikidata?.split(';').map((s) => s.trim()).find((s) => /^Q\d+$/.test(s));
  return first ?? null;
}

export function createOsmAdapter(source: SourceConfig, categories: CategoriesConfig): SourceAdapter {
  const cfg = source.overpass;
  if (!cfg) throw new Error(`${source.id}: overpass settings missing in config/sources.json`);
  return {
    id: source.id,
    async fetch(state, ctx) {
      const payload = await fetchJson(ctx, buildOverpassRequest(source, state), (body) => {
        const r = body as OverpassResponse;
        if (!Array.isArray(r?.elements)) return 'unexpected Overpass JSON shape';
        // Overpass reports query timeouts as HTTP 200 with a runtime-error remark and partial data.
        if (r.remark && /runtime error/i.test(r.remark)) return `Overpass remark: ${r.remark}`;
        return null;
      });
      return [payload];
    },
    normalize(raw) {
      const records: CandidateRecord[] = [];
      for (const payload of raw) {
        for (const el of (payload.body as OverpassResponse).elements) {
          const tags = el.tags ?? {};
          if (!matchesFilters(tags, cfg)) continue;
          const name = osmName(tags);
          if (!name) continue; // unnamed elements are skipped
          const pos = elementPosition(el);
          const ref = `${el.type}/${el.id}`;
          records.push({
            key: osmId(el.type, el.id),
            source: source.id,
            name,
            lon: pos?.[0] ?? null,
            lat: pos?.[1] ?? null,
            wikidataQid: osmWikidataTag(tags),
            category: categorize(categories, { osmTags: tags }),
            districtClaim: null,
            designations: [],
            asiIds: [],
            whsIds: [],
            unesco: null,
            period: periodFromOsmStartDate(tags.start_date),
            description: null,
            imageFile: null,
            sourceRef: {
              name: source.id,
              id: ref,
              url: `https://www.openstreetmap.org/${ref}`,
              license: source.license,
              licenseUrl: source.licenseUrl,
              retrievedAt: payload.fetchedAt,
            },
          });
        }
      }
      return records.sort((a, b) => compareStrings(a.key, b.key));
    },
  };
}
