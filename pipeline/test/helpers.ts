import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { StateConfig } from '@heritagetrail/shared';
import type { CandidateRecord, RawPayload } from '../src/adapters/types.ts';
import type { DistrictProps, StateProps } from '../src/adapters/boundaries.ts';
import { getState, loadConfig } from '../src/config.ts';
import type { LocatedCandidate } from '../src/dedupe.ts';
import { pathsFor, REPO_ROOT } from '../src/paths.ts';
import { stateGeometry } from '../src/validate.ts';

export const TEST_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(TEST_DIR, 'fixtures');
export const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
export const fixture = <T = unknown>(name: string): T => JSON.parse(fixtureText(name)) as T;

export const config = loadConfig(pathsFor(REPO_ROOT));
export const tamilNadu = getState(config, 'tamil-nadu');

export const WD_FETCHED = '2026-10-30T08:13:28.994Z';
export const OSM_FETCHED = '2026-10-30T08:14:12.597Z';
export const wikidataPayloads = (): RawPayload[] =>
  (['asi', 'museums', 'whs'] as const).map((n) => ({ name: n, fetchedAt: WD_FETCHED, body: fixture(`wikidata-${n}.json`) }));
export const overpassPayloads = (): RawPayload[] => [{ name: 'sites', fetchedAt: OSM_FETCHED, body: fixture('overpass-sites.json') }];

const square = (minLon: number, minLat: number, maxLon: number, maxLat: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
});

/** Synthetic test state "Testland" = lon 78-80, lat 10-12, with west/east districts; "Neighbour" east of it. */
export function syntheticGeometry() {
  const state: StateConfig = { ...tamilNadu, slug: 'testland', name: 'Testland' };
  const stateFeature: Feature<Polygon | MultiPolygon, StateProps> = {
    type: 'Feature',
    properties: { name: 'Testland', shapeName: 'Testland', shapeISO: 'IN-TN', shapeID: 't' },
    geometry: square(78, 10, 80, 12),
  };
  const district = (name: string, g: Polygon): Feature<Polygon, DistrictProps> => ({
    type: 'Feature',
    properties: { name, shapeName: name, shapeID: name, stateCode: 'IN-TN', areaKm2: 1 },
    geometry: g,
  });
  const neighbour: Feature<Polygon, StateProps> = {
    type: 'Feature',
    properties: { name: 'Neighbour', shapeName: 'Neighbour', shapeISO: 'IN-XX', shapeID: 'n' },
    geometry: square(80, 10, 82, 12),
  };
  return stateGeometry(
    state,
    stateFeature,
    [district('Kancheepuram', square(78, 10, 79, 12)), district('The Nilgiris', square(79, 10, 80, 12))],
    [stateFeature, neighbour],
  );
}

let seq = 0;
/** A located candidate with sensible defaults. */
export function candidate(over: Partial<LocatedCandidate> & { key: string }): LocatedCandidate {
  const isWd = over.key.startsWith('wd-');
  const source = over.source ?? (isWd ? 'wikidata' : 'osm-overpass');
  const ref = isWd ? over.key.slice(3) : over.key.replace(/^osm-(\w+)-/, '$1/');
  const base: CandidateRecord = {
    key: over.key,
    source,
    name: `Site ${++seq}`,
    lon: 79,
    lat: 11,
    wikidataQid: isWd ? over.key.slice(3) : null,
    category: 'temple',
    districtClaim: null,
    designations: [],
    asiIds: [],
    whsIds: [],
    unesco: null,
    period: null,
    description: null,
    imageFile: null,
    sourceRef: {
      name: source,
      id: ref,
      url: isWd ? `https://www.wikidata.org/wiki/${ref}` : `https://www.openstreetmap.org/${ref}`,
      license: isWd ? 'CC0-1.0' : 'ODbL-1.0',
      licenseUrl: isWd ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://opendatacommons.org/licenses/odbl/1-0/',
      retrievedAt: isWd ? WD_FETCHED : OSM_FETCHED,
    },
  };
  return { ...base, locationFlags: [], ...over } as LocatedCandidate;
}

/** Move a [lon, lat] point east by `km` (approximate, for test spacing). */
export const eastOf = (lon: number, lat: number, km: number): number => lon + km / (111.32 * Math.cos((lat * Math.PI) / 180));
