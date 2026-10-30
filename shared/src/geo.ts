const EARTH_RADIUS_KM = 6371.0088;

/** India bounding box used for the coarse coordinate check (decision 14). */
export const INDIA_BBOX = { minLon: 68.0, maxLon: 97.5, minLat: 6.0, maxLat: 37.5 } as const;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two [lon, lat] points. */
export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInIndiaBbox(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= INDIA_BBOX.minLon &&
    lon <= INDIA_BBOX.maxLon &&
    lat >= INDIA_BBOX.minLat &&
    lat <= INDIA_BBOX.maxLat
  );
}

/** Lowercase, strip diacritics (NFD), remove punctuation and collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
