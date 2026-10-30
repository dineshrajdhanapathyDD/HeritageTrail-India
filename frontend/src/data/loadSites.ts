import { z } from 'zod';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { HeritageCollection, StateCode, type CollectionMetadata, type HeritageFeature } from '@heritagetrail/shared';

/** Served from /data/ (copied from data/processed by scripts/sync-data.mjs). */
export const DATA_BASE = '/data/';
export const INDIA_STATES_FILE = 'boundaries/india-states.geojson';

const relPath = z.string().regex(/^[a-z0-9][a-z0-9/_.-]*\.(geo)?json$/, 'unexpected data path');

export const StateIndexEntry = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  code: StateCode,
  name: z.string().min(1),
  file: relPath,
  featureCount: z.number().int().nonnegative(),
  verifiedCount: z.number().int().nonnegative(),
  stateBoundaryFile: relPath.optional(),
  districtsFile: relPath.optional(),
});
export type StateIndexEntry = z.infer<typeof StateIndexEntry>;
const StateIndex = z.array(StateIndexEntry).min(1);

export interface DistrictProps {
  name: string;
  stateCode: string;
  areaKm2: number | null;
}
export type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictProps>;

const DistrictFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    name: z.string().min(1),
    stateCode: StateCode,
    areaKm2: z.number().positive().nullable().optional(),
  }),
  geometry: z.object({ type: z.enum(['Polygon', 'MultiPolygon']), coordinates: z.array(z.any()) }),
});
const BoundaryCollection = z.object({
  type: z.literal('FeatureCollection'),
  metadata: z
    .object({
      source: z.object({ name: z.string(), license: z.string(), licenseUrl: z.string(), attribution: z.string() }).partial(),
    })
    .partial()
    .optional(),
  features: z.array(z.unknown()),
});

/** Subset of `<slug>.report.json` used by the insights panel; unknown keys are ignored. */
export const StateReport = z.object({
  stateCode: StateCode,
  counts: z.object({ rejected: z.number().int().nonnegative() }).partial().optional(),
  asiCoverage: z
    .object({
      asiPublishedCount: z.number().int().nonnegative(),
      asiSource: z.url(),
      asiAsOf: z.string(),
      distinctCentralAsiIds: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
      note: z.string(),
    })
    .nullable()
    .optional(),
  districts: z.object({ note: z.string() }).partial().optional(),
});
export type StateReport = z.infer<typeof StateReport>;

export interface BoundarySourceInfo {
  name?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
}

export interface LoadedData {
  states: StateIndexEntry[];
  features: HeritageFeature[];
  collections: CollectionMetadata[];
  districts: FeatureCollection<Polygon | MultiPolygon, DistrictProps>;
  stateBoundaries: FeatureCollection;
  boundarySources: BoundarySourceInfo[];
  reports: Record<string, StateReport>;
  /** Per-state files that failed to load or validate; the rest of the app keeps working. */
  errors: string[];
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadSites(fetchFn: typeof fetch = fetch, base: string = DATA_BASE): Promise<LoadedData> {
  const states = StateIndex.parse(await getJson(fetchFn, `${base}index.json`));
  const out: LoadedData = {
    states,
    features: [],
    collections: [],
    districts: { type: 'FeatureCollection', features: [] },
    stateBoundaries: { type: 'FeatureCollection', features: [] },
    boundarySources: [],
    reports: {},
    errors: [],
  };
  const seenSources = new Set<string>();
  const addBoundarySource = (meta: z.infer<typeof BoundaryCollection>['metadata']) => {
    const s = meta?.source;
    if (s?.name && !seenSources.has(s.name)) {
      seenSources.add(s.name);
      out.boundarySources.push(s);
    }
  };

  await Promise.all(
    states.map(async (entry) => {
      try {
        const collection = HeritageCollection.parse(await getJson(fetchFn, `${base}${entry.file}`));
        out.features.push(...collection.features);
        out.collections.push(collection.metadata);
      } catch (err) {
        out.errors.push(`${entry.name}: ${err instanceof Error ? err.message.slice(0, 200) : 'load failed'}`);
        return;
      }
      const reportFile = entry.file.replace(/\.geojson$/, '.report.json');
      const optional: Promise<void>[] = [
        getJson(fetchFn, `${base}${reportFile}`)
          .then((r) => {
            const parsed = StateReport.safeParse(r);
            if (parsed.success) out.reports[entry.code] = parsed.data;
          })
          .catch(() => undefined),
      ];
      if (entry.districtsFile) {
        optional.push(
          getJson(fetchFn, `${base}${entry.districtsFile}`)
            .then((raw) => {
              const fc = BoundaryCollection.parse(raw);
              addBoundarySource(fc.metadata);
              for (const f of fc.features) {
                const parsed = DistrictFeatureSchema.safeParse(f);
                if (parsed.success) {
                  const feature = f as DistrictFeature;
                  feature.properties.areaKm2 = parsed.data.properties.areaKm2 ?? null;
                  out.districts.features.push(feature);
                }
              }
            })
            .catch(() => {
              out.errors.push(`${entry.name}: district boundaries unavailable`);
            }),
        );
      }
      if (entry.stateBoundaryFile) {
        optional.push(
          getJson(fetchFn, `${base}${entry.stateBoundaryFile}`)
            .then((raw) => {
              const fc = BoundaryCollection.parse(raw);
              addBoundarySource(fc.metadata);
              out.stateBoundaries.features.push(...(fc.features as Feature[]));
            })
            .catch(() => undefined),
        );
      }
      await Promise.all(optional);
    }),
  );

  out.features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return out;
}
