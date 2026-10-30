import { describe, expect, it } from 'vitest';
import { HeritageCollection } from '@heritagetrail/shared';
import { computeInsights, densityLookup, districtKey } from './insights.ts';
import { committedDistricts, committedFeatures, readProcessed } from '../test/committedData.ts';

describe('insights computed from the committed GeoJSON', () => {
  const features = committedFeatures();
  const districts = committedDistricts();
  const meta = HeritageCollection.parse(JSON.parse(readProcessed('tamil-nadu.geojson'))).metadata;

  it('totals match the collection metadata', () => {
    const ins = computeInsights(features, districts, { includeUnverified: false });
    expect(ins.totalPublished).toBe(meta.counts.total);
    expect(ins.totalVerified).toBe(meta.counts.verified);
    expect(ins.totalUnverified).toBe(meta.counts.unverified);
    expect(ins.byState).toEqual([
      { stateCode: 'IN-TN', state: 'Tamil Nadu', verified: meta.counts.verified, unverified: meta.counts.unverified },
    ]);
    for (const c of ins.byCategory) {
      expect(c.verified + c.unverified).toBe(meta.counts.byCategory[c.category] ?? 0);
    }
  });

  it('district density = count / polygon area, one row per district polygon', () => {
    const ins = computeInsights(features, districts, { includeUnverified: false });
    expect(ins.byDistrict.filter((d) => d.areaKm2 !== null)).toHaveLength(districts.length);
    const verifiedWithDistrict = features.filter(
      (f) => f.properties.verificationStatus === 'verified' && f.properties.district,
    ).length;
    expect(ins.byDistrict.reduce((s, d) => s + d.count, 0)).toBe(verifiedWithDistrict);
    for (const d of ins.byDistrict) {
      if (d.areaKm2) expect(d.densityPer1000Km2).toBeCloseTo((d.count / d.areaKm2) * 1000, 1);
    }
    // sorted by density, highest first
    const dens = ins.byDistrict.map((d) => d.densityPer1000Km2 ?? -1);
    expect([...dens].sort((a, b) => b - a)).toEqual(dens);
  });

  it('including unverified records raises district counts to all published records', () => {
    const ins = computeInsights(features, districts, { includeUnverified: true });
    expect(ins.districtBasis).toBe('all');
    expect(ins.byDistrict.reduce((s, d) => s + d.count, 0)).toBe(features.filter((f) => f.properties.district).length);
  });

  it('builds a density lookup keyed by state and normalised name', () => {
    const ins = computeInsights(features, districts, { includeUnverified: false });
    const lookup = densityLookup(ins);
    const chennai = ins.byDistrict.find((d) => d.district === 'Chennai');
    expect(chennai).toBeDefined();
    expect(lookup.get(districtKey('IN-TN', 'chennai'))).toBe(chennai!.densityPer1000Km2);
  });

  it('counts UNESCO statuses from the data', () => {
    const ins = computeInsights(features, districts, { includeUnverified: true });
    const expected = { inscribed: 0, component: 0, tentative: 0 };
    for (const f of features) if (f.properties.unesco) expected[f.properties.unesco] += 1;
    expect(ins.unesco).toEqual(expected);
  });
});
