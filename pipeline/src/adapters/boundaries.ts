import { area } from '@turf/area';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointOnFeature } from '@turf/point-on-feature';
import { simplify } from '@turf/simplify';
import { truncate } from '@turf/truncate';
import type { SourceConfig, StateConfig } from '@heritagetrail/shared';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { bboxOf, inBBox, plainName, type AreaFeature } from '../geojson.ts';
import type { RawFetchRequest, RawFetcher } from '../rawStore.ts';
import { compareStrings } from '../rawStore.ts';
import { fetchJson, SourceFetchError } from './types.ts';

export interface GbProperties {
  shapeName: string;
  shapeISO?: string;
  shapeID: string;
  shapeGroup?: string;
  shapeType?: string;
}
export type GbCollection = FeatureCollection<Polygon | MultiPolygon, GbProperties>;

export interface DownloadedBoundary {
  source: SourceConfig;
  /** URL of the GeoJSON actually downloaded (from the API's simplifiedGeometryGeoJSON). */
  downloadUrl: string;
  retrievedAt: string;
  collection: GbCollection;
}

const apiRequest = (source: SourceConfig): RawFetchRequest => ({ source: source.id, name: 'api', url: source.endpoint, method: 'GET' });

/** Query the geoBoundaries API, then download its `simplifiedGeometryGeoJSON`. */
export async function fetchBoundary(source: SourceConfig, ctx: RawFetcher): Promise<DownloadedBoundary> {
  const api = await fetchJson(ctx, apiRequest(source));
  const url = (api.body as { simplifiedGeometryGeoJSON?: string }).simplifiedGeometryGeoJSON;
  if (!url) throw new SourceFetchError(source.id, 'api', null, 'simplifiedGeometryGeoJSON missing from API response');
  const geo = await fetchJson(ctx, { source: source.id, name: 'simplified', url, method: 'GET' }, (b) =>
    Array.isArray((b as GbCollection)?.features) ? null : 'not a FeatureCollection',
  );
  return { source, downloadUrl: url, retrievedAt: geo.fetchedAt, collection: geo.body as GbCollection };
}

export interface StateProps {
  name: string;
  shapeName: string;
  shapeISO: string;
  shapeID: string;
}
export interface DistrictProps {
  name: string;
  shapeName: string;
  shapeID: string;
  stateCode: string;
  areaKm2: number;
}

export interface BoundaryMetadata {
  source: {
    id: string;
    name: string;
    publisher: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    provenanceNote: string | null;
    endpoint: string;
    downloadUrl: string;
  };
  retrievedAt: string;
  processing: string;
}

export interface StateBoundaryOutput {
  state: StateConfig;
  stateFeature: AreaFeature<StateProps>;
  districts: AreaFeature<DistrictProps>[];
  districtCount: { expected: number; actual: number; ok: boolean };
}

export interface BoundaryOutputs {
  indiaStates: { metadata: BoundaryMetadata; features: AreaFeature<StateProps>[] };
  states: { metadata: BoundaryMetadata; districtsMetadata: BoundaryMetadata; output: StateBoundaryOutput }[];
}

function metadataFor(b: DownloadedBoundary, processing: string): BoundaryMetadata {
  const s = b.source;
  return {
    source: {
      id: s.id,
      name: s.name,
      publisher: s.publisher,
      license: s.license,
      licenseUrl: s.licenseUrl,
      attribution: s.attribution,
      provenanceNote: s.provenanceNote,
      endpoint: s.endpoint,
      downloadUrl: b.downloadUrl,
    },
    retrievedAt: b.retrievedAt,
    processing,
  };
}

const stateProps = (p: GbProperties): StateProps => ({
  name: plainName(p.shapeName),
  shapeName: p.shapeName,
  shapeISO: p.shapeISO ?? '',
  shapeID: p.shapeID,
});

/**
 * Assign each ADM2 district to the ADM1 unit containing its pointOnFeature. When several ADM1
 * polygons contain the point (an enclave not cut out of the surrounding state), the smallest wins.
 */
export function assignDistricts(adm1: GbCollection, adm2: GbCollection): Map<string, AreaFeature<GbProperties>[]> {
  const units = adm1.features.map((f) => ({ f, bbox: bboxOf(f), area: area(f), iso: f.properties.shapeISO ?? '' }));
  const byIso = new Map<string, AreaFeature<GbProperties>[]>();
  for (const d of adm2.features) {
    const p = pointOnFeature(d);
    const [lon, lat] = p.geometry.coordinates as [number, number];
    const containing = units
      .filter((u) => inBBox(u.bbox, lon, lat) && booleanPointInPolygon(p, u.f))
      .sort((a, b) => a.area - b.area);
    const iso = containing[0]?.iso;
    if (!iso) continue;
    const list = byIso.get(iso) ?? [];
    list.push(d);
    byIso.set(iso, list);
  }
  return byIso;
}

export const INDIA_STATES_TOLERANCE = 0.005;

export function buildBoundaryOutputs(adm1: DownloadedBoundary, adm2: DownloadedBoundary, states: readonly StateConfig[]): BoundaryOutputs {
  const simplified = truncate(
    simplify(adm1.collection, { tolerance: INDIA_STATES_TOLERANCE, highQuality: false, mutate: false }),
    { precision: 5, coordinates: 2, mutate: true },
  ) as GbCollection;
  const indiaFeatures = simplified.features
    .map((f) => ({ type: 'Feature' as const, properties: stateProps(f.properties), geometry: f.geometry }))
    .sort((a, b) => compareStrings(a.properties.shapeISO, b.properties.shapeISO) || compareStrings(a.properties.name, b.properties.name));

  const assigned = assignDistricts(adm1.collection, adm2.collection);
  const out: BoundaryOutputs['states'] = [];
  for (const state of states) {
    const f = adm1.collection.features.find((x) => x.properties.shapeISO === state.adm1ShapeISO);
    if (!f) throw new Error(`geoBoundaries ADM1 has no feature with shapeISO ${state.adm1ShapeISO} (${state.slug})`);
    const districts = (assigned.get(state.adm1ShapeISO) ?? [])
      .map((d) => ({
        type: 'Feature' as const,
        properties: {
          name: plainName(d.properties.shapeName),
          shapeName: d.properties.shapeName,
          shapeID: d.properties.shapeID,
          stateCode: state.code,
          areaKm2: Math.round(area(d) / 1e5) / 10,
        },
        geometry: d.geometry,
      }))
      .sort((a, b) => compareStrings(a.properties.name, b.properties.name) || compareStrings(a.properties.shapeID, b.properties.shapeID));
    out.push({
      metadata: metadataFor(adm1, `Exact geoBoundaries polygon for shapeISO ${state.adm1ShapeISO}`),
      districtsMetadata: metadataFor(
        adm2,
        `geoBoundaries ADM2 features whose pointOnFeature lies inside the ${state.adm1ShapeISO} ADM1 polygon (smallest containing ADM1 unit wins); areaKm2 from @turf/area`,
      ),
      output: {
        state,
        stateFeature: { type: 'Feature', properties: stateProps(f.properties), geometry: f.geometry },
        districts,
        districtCount: { expected: state.expectedDistrictCount, actual: districts.length, ok: districts.length === state.expectedDistrictCount },
      },
    });
  }
  return {
    indiaStates: {
      metadata: metadataFor(adm1, `turf simplify tolerance ${INDIA_STATES_TOLERANCE} (highQuality false), coordinates truncated to 5 decimals`),
      features: indiaFeatures,
    },
    states: out,
  };
}
