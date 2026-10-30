import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { isInIndiaBbox, normalizeName, type Flag, type StateConfig, type VerificationStatus } from '@heritagetrail/shared';
import { distance as levenshtein } from 'fastest-levenshtein';
import type { CandidateRecord } from './adapters/types.ts';
import type { DistrictProps, StateProps } from './adapters/boundaries.ts';
import { bboxOf, inBBox, type AreaFeature, type BBox } from './geojson.ts';

/** Points outside the claimed state polygon but within this distance of its edge are accepted. */
export const STATE_EDGE_TOLERANCE_KM = 2;
/** District names match when the Levenshtein ratio of their normalized forms is at least this. */
export const DISTRICT_MATCH_RATIO = 0.8;
/** Two sources "agree" when their coordinates are within this distance. */
export const AGREEMENT_KM = 0.5;

// 2 km is below 0.02 degrees of latitude and below 0.02 degrees of longitude south of 37.5°N.
const TOLERANCE_PAD_DEG = 0.025;

interface Indexed<P> {
  f: AreaFeature<P>;
  bbox: BBox;
}
const index = <P>(fs: readonly AreaFeature<P>[]): Indexed<P>[] => fs.map((f) => ({ f, bbox: bboxOf(f) }));

export interface StateGeometry {
  state: StateConfig;
  polygon: Indexed<StateProps>;
  districts: Indexed<DistrictProps>[];
  indiaStates: Indexed<StateProps>[];
}

export function stateGeometry(
  state: StateConfig,
  stateFeature: AreaFeature<StateProps>,
  districts: readonly AreaFeature<DistrictProps>[],
  indiaStates: readonly AreaFeature<StateProps>[],
): StateGeometry {
  return { state, polygon: { f: stateFeature, bbox: bboxOf(stateFeature) }, districts: index(districts), indiaStates: index(indiaStates) };
}

export type RejectReason = 'missing-name' | 'missing-coordinates' | 'outside-india-bbox' | 'outside-claimed-state';

export type LocationResult =
  | { ok: true; flags: Flag[] }
  | { ok: false; reason: RejectReason; detectedState: string | null };

const contains = <P>(x: Indexed<P>, lon: number, lat: number): boolean =>
  inBBox(x.bbox, lon, lat) && booleanPointInPolygon([lon, lat], x.f.geometry);

const edgeDistanceKm = <P>(x: Indexed<P>, lon: number, lat: number): number =>
  inBBox(x.bbox, lon, lat, TOLERANCE_PAD_DEG)
    ? pointToPolygonDistance([lon, lat], x.f.geometry, { units: 'kilometers' })
    : Infinity;

/** State (from the simplified all-India layer) containing a point, for rejection reports. */
export function detectState(geo: StateGeometry, lon: number, lat: number): string | null {
  return geo.indiaStates.find((s) => contains(s, lon, lat))?.f.properties.name ?? null;
}

/** Name and coordinate checks: India bbox, then the claimed state polygon with a 2 km edge tolerance. */
export function validateLocation(c: Pick<CandidateRecord, 'name' | 'lon' | 'lat'>, geo: StateGeometry): LocationResult {
  if (!c.name) return { ok: false, reason: 'missing-name', detectedState: null };
  if (c.lon === null || c.lat === null) return { ok: false, reason: 'missing-coordinates', detectedState: null };
  const { lon, lat } = c;
  if (!isInIndiaBbox(lon, lat)) return { ok: false, reason: 'outside-india-bbox', detectedState: null };
  if (contains(geo.polygon, lon, lat)) return { ok: true, flags: [] };
  if (edgeDistanceKm(geo.polygon, lon, lat) <= STATE_EDGE_TOLERANCE_KM) return { ok: true, flags: ['boundary-tolerance'] };
  return { ok: false, reason: 'outside-claimed-state', detectedState: detectState(geo, lon, lat) };
}

/** Normalized district name for comparison: "The Nilgiris district" -> "nilgiris". */
export function districtKey(name: string): string {
  return normalizeName(name).replace(/^the /, '').replace(/ district$/, '').trim();
}

export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export const districtsMatch = (a: string, b: string): boolean =>
  levenshteinRatio(districtKey(a), districtKey(b)) >= DISTRICT_MATCH_RATIO;

/** ADM2 district containing the point, or the nearest one within the edge tolerance. */
export function findDistrict(geo: StateGeometry, lon: number, lat: number): string | null {
  const hit = geo.districts.find((d) => contains(d, lon, lat));
  if (hit) return hit.f.properties.name;
  let best: { name: string; km: number } | null = null;
  for (const d of geo.districts) {
    const km = edgeDistanceKm(d, lon, lat);
    if (km <= STATE_EDGE_TOLERANCE_KM && (!best || km < best.km)) best = { name: d.f.properties.name, km };
  }
  return best?.name ?? null;
}

export interface DistrictAssignment {
  district: string | null;
  flags: Flag[];
  /** District claimed by the source (Wikidata P131). */
  claimed: string | null;
  /** ADM2 polygon containing the point (or nearest within 2 km). */
  adm2: string | null;
}

/**
 * District from the source claim vs the ADM2 polygon (ARCHITECTURE.md section 5):
 * - claim matches ADM2 (ratio >= 0.8): ADM2 spelling, so names line up with the district layer;
 * - no claim: ADM2 name + `district-derived`;
 * - claim disagrees: the claim is kept + `district-mismatch` (the 2026-10-30 run showed
 *   geoBoundaries ADM2 with Kancheepuram/Chengalputtu names swapped, confirmed against OSM);
 * - neither: null + `missing-district`.
 */
export function assignDistrict(geo: StateGeometry, lon: number, lat: number, claim: string | null): DistrictAssignment {
  const adm2 = findDistrict(geo, lon, lat);
  const base = { claimed: claim, adm2 };
  if (adm2 && claim) {
    return districtsMatch(claim, adm2)
      ? { ...base, district: adm2, flags: [] }
      : { ...base, district: canonicalDistrict(geo, claim), flags: ['district-mismatch'] };
  }
  if (adm2) return { ...base, district: adm2, flags: ['district-derived'] };
  if (claim) return { ...base, district: canonicalDistrict(geo, claim), flags: [] };
  return { ...base, district: null, flags: ['missing-district'] };
}

/** ADM2 spelling of a claimed district name when one matches (ratio >= 0.8), else the claim as given. */
export function canonicalDistrict(geo: StateGeometry, claim: string): string {
  const key = districtKey(claim);
  let best: { name: string; ratio: number } | null = null;
  for (const d of geo.districts) {
    const name = d.f.properties.name;
    const ratio = levenshteinRatio(key, districtKey(name));
    if (ratio >= DISTRICT_MATCH_RATIO && (!best || ratio > best.ratio || (ratio === best.ratio && name < best.name))) {
      best = { name, ratio };
    }
  }
  return best?.name ?? claim;
}

/**
 * Decision 14: verified when inside the state (location checks passed) with an ASI Monument ID or
 * a UNESCO WHS ID, or when two different sources agree within 500 m. Otherwise unverified.
 */
export function verificationStatus(input: { hasAsiId: boolean; hasWhsId: boolean; sourcesAgree: boolean }): Exclude<VerificationStatus, 'rejected'> {
  return input.hasAsiId || input.hasWhsId || input.sourcesAgree ? 'verified' : 'unverified';
}
