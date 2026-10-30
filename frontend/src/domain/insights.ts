import area from '@turf/area';
import { CATEGORIES, normalizeName, type Category, type HeritageFeature } from '@heritagetrail/shared';
import type { DistrictFeature } from '../data/loadSites.ts';

export interface StateCount {
  stateCode: string;
  state: string;
  verified: number;
  unverified: number;
}

export interface CategoryCount {
  category: Category;
  verified: number;
  unverified: number;
}

export interface DistrictDensity {
  stateCode: string;
  district: string;
  count: number;
  areaKm2: number | null;
  /** Sites per 1,000 km2; null when the district has no polygon. */
  densityPer1000Km2: number | null;
}

export interface Insights {
  totalPublished: number;
  totalVerified: number;
  totalUnverified: number;
  /** Which records the district counts include. */
  districtBasis: 'verified' | 'all';
  byState: StateCount[];
  byCategory: CategoryCount[];
  byDistrict: DistrictDensity[];
  unesco: { inscribed: number; component: number; tentative: number };
  withImage: number;
  withPeriod: number;
  withDescription: number;
}

const districtKey = (stateCode: string, name: string) => `${stateCode}|${normalizeName(name)}`;

export function districtAreaKm2(d: DistrictFeature): number {
  return d.properties.areaKm2 ?? Math.round((area(d) / 1e6) * 10) / 10;
}

/**
 * All numbers come from the loaded GeoJSON: published features and the district polygons. District density is
 * count / polygon area, matched by state code and normalised district name.
 */
export function computeInsights(
  features: readonly HeritageFeature[],
  districts: readonly DistrictFeature[],
  options: { includeUnverified: boolean },
): Insights {
  const byState = new Map<string, StateCount>();
  const byCategory = new Map<Category, CategoryCount>(
    CATEGORIES.map((c) => [c, { category: c, verified: 0, unverified: 0 }]),
  );
  const districtCounts = new Map<string, DistrictDensity>();
  for (const d of districts) {
    const a = districtAreaKm2(d);
    districtCounts.set(districtKey(d.properties.stateCode, d.properties.name), {
      stateCode: d.properties.stateCode,
      district: d.properties.name,
      count: 0,
      areaKm2: a,
      densityPer1000Km2: 0,
    });
  }

  const ins: Insights = {
    totalPublished: features.length,
    totalVerified: 0,
    totalUnverified: 0,
    districtBasis: options.includeUnverified ? 'all' : 'verified',
    byState: [],
    byCategory: [],
    byDistrict: [],
    unesco: { inscribed: 0, component: 0, tentative: 0 },
    withImage: 0,
    withPeriod: 0,
    withDescription: 0,
  };

  for (const f of features) {
    const p = f.properties;
    const verified = p.verificationStatus === 'verified';
    if (verified) ins.totalVerified += 1;
    else ins.totalUnverified += 1;
    const s = byState.get(p.stateCode) ?? { stateCode: p.stateCode, state: p.state, verified: 0, unverified: 0 };
    s[verified ? 'verified' : 'unverified'] += 1;
    byState.set(p.stateCode, s);
    const c = byCategory.get(p.category);
    if (c) c[verified ? 'verified' : 'unverified'] += 1;
    if (p.unesco) ins.unesco[p.unesco] += 1;
    if (p.image) ins.withImage += 1;
    if (p.period) ins.withPeriod += 1;
    if (p.description) ins.withDescription += 1;

    if ((verified || options.includeUnverified) && p.district) {
      const key = districtKey(p.stateCode, p.district);
      const entry =
        districtCounts.get(key) ??
        ({ stateCode: p.stateCode, district: p.district, count: 0, areaKm2: null, densityPer1000Km2: null } as DistrictDensity);
      entry.count += 1;
      districtCounts.set(key, entry);
    }
  }

  ins.byState = [...byState.values()].sort((a, b) => b.verified + b.unverified - (a.verified + a.unverified));
  ins.byCategory = [...byCategory.values()];
  ins.byDistrict = [...districtCounts.values()]
    .map((d) => ({
      ...d,
      densityPer1000Km2: d.areaKm2 ? Math.round((d.count / d.areaKm2) * 1000 * 100) / 100 : null,
    }))
    .sort(
      (a, b) =>
        (b.densityPer1000Km2 ?? -1) - (a.densityPer1000Km2 ?? -1) || b.count - a.count || a.district.localeCompare(b.district),
    );
  return ins;
}

/** Lookup for the density choropleth: `<stateCode>|<normalised name>` to density. */
export function densityLookup(insights: Insights): Map<string, number> {
  return new Map(
    insights.byDistrict
      .filter((d) => d.densityPer1000Km2 !== null)
      .map((d) => [districtKey(d.stateCode, d.district), d.densityPer1000Km2 as number]),
  );
}

export { districtKey };
