import ngeohash from 'ngeohash';
import { normalizeName, type HeritageFeature, type HeritageSiteProperties } from '@heritagetrail/shared';

/** DynamoDB key design, ARCHITECTURE.md section 7 (plan decision 19). */
export const GEOHASH_PRECISION = 3;

export const siteKey = (id: string) => ({ pk: `SITE#${id}`, sk: 'META' });
export const statsKey = (stateCode: string) => ({ pk: `STATS#${stateCode}`, sk: 'META' });
export const summaryKey = (id: string, modelId: string) => ({ pk: `SITE#${id}`, sk: `SUMMARY#${modelId}` });
export const statePk = (stateCode: string) => `STATE#${stateCode}`;
export const geoPk = (hash: string) => `GH3#${hash}`;

export interface SiteItem extends HeritageSiteProperties {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  /** normalizeName(name), used by the `q` filter on GET /sites. */
  nameNorm: string;
  lon: number;
  lat: number;
}

/** Category plus normalised name; used as GSI1 sort key prefix and for `q` filtering. */
export function gsi1Sort(p: Pick<HeritageSiteProperties, 'category' | 'name' | 'id'>): string {
  return `${p.category}#${normalizeName(p.name)}#${p.id}`;
}

export function featureToItem(f: HeritageFeature): SiteItem {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  return {
    ...siteKey(p.id),
    gsi1pk: statePk(p.stateCode),
    gsi1sk: gsi1Sort(p),
    gsi2pk: geoPk(ngeohash.encode(lat, lon, GEOHASH_PRECISION)),
    gsi2sk: p.id,
    nameNorm: normalizeName(p.name),
    ...p,
    lon,
    lat,
  };
}

const KEY_FIELDS = ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', 'nameNorm', 'lon', 'lat'] as const;

export function itemToFeature(item: Record<string, unknown>): HeritageFeature {
  const props: Record<string, unknown> = { ...item };
  for (const k of KEY_FIELDS) delete props[k];
  const properties = props as unknown as HeritageSiteProperties;
  return {
    type: 'Feature',
    id: properties.id,
    geometry: { type: 'Point', coordinates: [item.lon as number, item.lat as number] },
    properties,
  };
}
