import type { CategoriesConfig, SourceConfig, StateConfig, UnescoStatus } from '@heritagetrail/shared';
import { wikidataId } from '@heritagetrail/shared';
import type { RawFetchRequest } from '../rawStore.ts';
import { compareStrings } from '../rawStore.ts';
import { categorize, periodFromWikidata, stripDistrictSuffix, WIKIDATA_LICENSE, type WikidataTime } from '../normalize.ts';
import { fetchJson, type CandidateRecord, type RawPayload, type SourceAdapter } from './types.ts';

/**
 * Three split queries per state (a combined query timed out with HTTP 504 in Phase 1).
 * Each selects items located (transitively, P131*) in the state with coordinates (P625).
 */
export const WIKIDATA_QUERIES = {
  /** Items with an ASI Monument ID (P1371). */
  asi: '?item wdt:P1371 [] .',
  /** Items that are an instance of museum (Q33506). */
  museums: '?item wdt:P31 wd:Q33506 .',
  /** Items with a UNESCO World Heritage Site ID (P757). */
  whs: '?item wdt:P757 [] .',
} as const;
export type WikidataQueryName = keyof typeof WIKIDATA_QUERIES;

export function buildSparql(selector: string, stateQid: string): string {
  if (!/^Q\d+$/.test(stateQid)) throw new Error(`Invalid QID ${stateQid}`);
  return `SELECT ?item ?itemLabel ?coord ?asi ?whs ?districtLabel ?image ?inception ?inceptionPrecision ?heritageLabel ?typeName ?description WHERE {
  ${selector}
  ?item wdt:P131* wd:${stateQid} ; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P1371 ?asi }
  OPTIONAL { ?item wdt:P757 ?whs }
  OPTIONAL { ?item wdt:P131 ?district . ?district wdt:P31 wd:Q1149652 . }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL {
    ?item p:P571 ?inceptionStatement .
    ?inceptionStatement psv:P571 ?inceptionValue .
    ?inceptionValue wikibase:timeValue ?inception ; wikibase:timePrecision ?inceptionPrecision .
    FILTER NOT EXISTS { ?inceptionStatement wikibase:rank wikibase:DeprecatedRank }
  }
  OPTIONAL { ?item wdt:P1435 ?heritage }
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeName . FILTER(LANG(?typeName) = "en") }
  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,ta". }
}
`;
}

export function buildWikidataRequest(source: SourceConfig, name: WikidataQueryName, state: StateConfig): RawFetchRequest {
  const query = buildSparql(WIKIDATA_QUERIES[name], state.wikidataQid);
  return {
    source: source.id,
    name,
    url: source.endpoint,
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ query }).toString(),
  };
}

interface Binding {
  type: string;
  value: string;
  datatype?: string;
}
type Row = Partial<Record<string, Binding>>;
interface SparqlResults {
  results: { bindings: Row[] };
}

/** WKT `Point(lon lat)` on Earth; values with a non-Earth globe prefix return null. */
export function parseWktPoint(wkt: string): [number, number] | null {
  const m = /^\s*Point\(\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*\)\s*$/i.exec(wkt);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/** Commons file name from a `Special:FilePath/<name>` URI. */
export function commonsFileFromUri(uri: string): string | null {
  const m = /Special:FilePath\/(.+)$/.exec(uri);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

const UNESCO_BY_DESIGNATION: Record<string, Exclude<UnescoStatus, null>> = {
  'world heritage site': 'inscribed',
  'part of unesco world heritage site': 'component',
  'tentative world heritage site': 'tentative',
};
const UNESCO_RANK = { inscribed: 3, component: 2, tentative: 1 } as const;

/** Map P1435 designation labels to the UNESCO status (strongest wins). */
export function unescoFromDesignations(labels: readonly string[]): UnescoStatus {
  let best: UnescoStatus = null;
  for (const label of labels) {
    const status = UNESCO_BY_DESIGNATION[label.trim().toLowerCase()];
    if (status && (best === null || UNESCO_RANK[status] > UNESCO_RANK[best])) best = status;
  }
  return best;
}

/** `https://whc.unesco.org/en/list/<numeric prefix of P757>`, e.g. 250bis-003 -> /250. */
export function unescoUrlFor(whsId: string): string | null {
  const m = /^(\d+)/.exec(whsId);
  return m ? `https://whc.unesco.org/en/list/${Number(m[1])}` : null;
}

interface Aggregate {
  qid: string;
  label: string | null;
  coords: Set<string>;
  asi: Set<string>;
  whs: Set<string>;
  districts: Set<string>;
  images: Set<string>;
  inceptions: Map<string, WikidataTime>;
  heritage: Set<string>;
  types: Set<string>;
  description: string | null;
  fetchedAt: string;
}

const sorted = (s: Iterable<string>): string[] => [...s].sort(compareStrings);

/** Aggregate SPARQL rows (one row per combination of optional values) into one entry per QID. */
export function aggregateRows(payloads: readonly RawPayload[]): Map<string, Aggregate> {
  const items = new Map<string, Aggregate>();
  for (const payload of payloads) {
    const rows = (payload.body as SparqlResults).results.bindings;
    for (const row of rows) {
      const itemUri = row.item?.value;
      const qid = itemUri ? /(Q\d+)$/.exec(itemUri)?.[1] : undefined;
      if (!qid) continue;
      let agg = items.get(qid);
      if (!agg) {
        agg = {
          qid,
          label: null,
          coords: new Set(),
          asi: new Set(),
          whs: new Set(),
          districts: new Set(),
          images: new Set(),
          inceptions: new Map(),
          heritage: new Set(),
          types: new Set(),
          description: null,
          fetchedAt: payload.fetchedAt,
        };
        items.set(qid, agg);
      }
      if (payload.fetchedAt > agg.fetchedAt) agg.fetchedAt = payload.fetchedAt;
      const label = row.itemLabel?.value?.trim();
      // The label service falls back to the bare QID when no label exists in en/mul/ta.
      if (label && label !== qid) agg.label = label;
      if (row.coord) agg.coords.add(row.coord.value);
      if (row.asi) agg.asi.add(row.asi.value.trim());
      if (row.whs) agg.whs.add(row.whs.value.trim());
      if (row.districtLabel && !/^Q\d+$/.test(row.districtLabel.value)) {
        agg.districts.add(stripDistrictSuffix(row.districtLabel.value));
      }
      if (row.image) {
        const file = commonsFileFromUri(row.image.value);
        if (file) agg.images.add(file);
      }
      if (row.inception && row.inceptionPrecision) {
        const t = { time: row.inception.value, precision: Number(row.inceptionPrecision.value) };
        agg.inceptions.set(`${t.time}|${t.precision}`, t);
      }
      if (row.heritageLabel && !/^Q\d+$/.test(row.heritageLabel.value)) agg.heritage.add(row.heritageLabel.value.trim());
      if (row.typeName) agg.types.add(row.typeName.value.trim());
      if (row.description?.value.trim()) agg.description = row.description.value.trim();
    }
  }
  return items;
}

const preferCentralAsiId = (ids: readonly string[]): string[] =>
  [...ids].sort((a, b) => Number(b.startsWith('N-')) - Number(a.startsWith('N-')) || compareStrings(a, b));

export function createWikidataAdapter(source: SourceConfig, categories: CategoriesConfig): SourceAdapter {
  const names = Object.keys(WIKIDATA_QUERIES) as WikidataQueryName[];
  return {
    id: source.id,
    async fetch(state, ctx) {
      const out: RawPayload[] = [];
      for (const name of names) {
        out.push(
          await fetchJson(ctx, buildWikidataRequest(source, name, state), (body) =>
            Array.isArray((body as SparqlResults)?.results?.bindings) ? null : 'unexpected SPARQL JSON shape',
          ),
        );
      }
      return out;
    },
    normalize(raw) {
      const records: CandidateRecord[] = [];
      for (const agg of aggregateRows(raw).values()) {
        const coord = sorted(agg.coords).map(parseWktPoint).find((p) => p !== null) ?? null;
        const types = sorted(agg.types);
        const designations = sorted(agg.heritage);
        const url = `https://www.wikidata.org/wiki/${agg.qid}`;
        records.push({
          key: wikidataId(agg.qid),
          source: source.id,
          name: agg.label,
          lon: coord?.[0] ?? null,
          lat: coord?.[1] ?? null,
          wikidataQid: agg.qid,
          category: categorize(categories, { wikidataLabels: types }),
          districtClaim: sorted(agg.districts)[0] ?? null,
          designations,
          asiIds: preferCentralAsiId([...agg.asi]),
          whsIds: sorted(agg.whs),
          unesco: unescoFromDesignations(designations),
          period: periodFromWikidata([...agg.inceptions.values()]),
          description: agg.description ? { text: agg.description, source: url, license: WIKIDATA_LICENSE } : null,
          imageFile: sorted(agg.images)[0] ?? null,
          sourceRef: {
            name: source.id,
            id: agg.qid,
            url,
            license: source.license,
            licenseUrl: source.licenseUrl,
            retrievedAt: agg.fetchedAt,
          },
        });
      }
      return records.sort((a, b) => compareStrings(a.key, b.key));
    },
  };
}
