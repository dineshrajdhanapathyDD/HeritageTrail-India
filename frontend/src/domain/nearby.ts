import { haversineKm, type HeritageFeature } from '@heritagetrail/shared';

export const RADIUS_MIN_KM = 1;
export const RADIUS_MAX_KM = 100;
export const DEFAULT_RADIUS_KM = 10;

export type LonLat = [number, number];

export interface NearbyResult {
  feature: HeritageFeature;
  distanceKm: number;
}

export function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return DEFAULT_RADIUS_KM;
  return Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, radiusKm));
}

/** Sites within `radiusKm` (clamped to 1-100) of `center`, nearest first; `excludeId` removes the centre site. */
export function findNearby(
  features: readonly HeritageFeature[],
  center: LonLat,
  radiusKm: number,
  excludeId?: string,
): NearbyResult[] {
  const r = clampRadius(radiusKm);
  const results: NearbyResult[] = [];
  for (const feature of features) {
    if (feature.properties.id === excludeId) continue;
    const d = haversineKm(center, feature.geometry.coordinates);
    if (d <= r) results.push({ feature, distanceKm: d });
  }
  return results.sort(
    (a, b) => a.distanceKm - b.distanceKm || a.feature.properties.name.localeCompare(b.feature.properties.name),
  );
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
