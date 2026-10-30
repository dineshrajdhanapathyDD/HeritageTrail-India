import { describe, expect, it } from 'vitest';
import { haversineKm } from '@heritagetrail/shared';
import { clampRadius, findNearby, formatKm, RADIUS_MAX_KM, RADIUS_MIN_KM } from './nearby.ts';
import { committedFeatures, featureById } from '../test/committedData.ts';

describe('nearby', () => {
  const features = committedFeatures();
  const shore = featureById('wd-Q1144279'); // Shore Temple, Mamallapuram

  it('clamps the radius to 1-100 km', () => {
    expect(clampRadius(0)).toBe(RADIUS_MIN_KM);
    expect(clampRadius(500)).toBe(RADIUS_MAX_KM);
    expect(clampRadius(25)).toBe(25);
    expect(clampRadius(Number.NaN)).toBe(10);
  });

  it('returns sites inside the radius sorted by distance, excluding the centre', () => {
    const res = findNearby(features, shore.geometry.coordinates, 2, shore.properties.id);
    expect(res.length).toBeGreaterThan(0);
    expect(res.map((r) => r.feature.properties.id)).not.toContain(shore.properties.id);
    expect(res.map((r) => r.feature.properties.id)).toContain('wd-Q1753664'); // Descent of the Ganges
    for (let i = 1; i < res.length; i++) expect(res[i]!.distanceKm).toBeGreaterThanOrEqual(res[i - 1]!.distanceKm);
    for (const r of res) {
      expect(r.distanceKm).toBeLessThanOrEqual(2);
      expect(r.distanceKm).toBeCloseTo(haversineKm(shore.geometry.coordinates, r.feature.geometry.coordinates), 9);
    }
  });

  it('a larger radius returns a superset', () => {
    const small = findNearby(features, shore.geometry.coordinates, 5).length;
    const large = findNearby(features, shore.geometry.coordinates, 50).length;
    expect(large).toBeGreaterThan(small);
  });

  it('formats distances', () => {
    expect(formatKm(0.25)).toBe('250 m');
    expect(formatKm(3.456)).toBe('3.5 km');
    expect(formatKm(42.4)).toBe('42 km');
  });
});
