import { describe, expect, it } from 'vitest';
import type { HeritageSiteProperties } from '@heritagetrail/shared';
import {
  DEFAULT_FILTERS,
  filterSites,
  matchesQuery,
  periodBucket,
  periodBucketLabel,
  periodOptions,
  toggleValue,
} from './filters.ts';
import { committedFeatures, featureById } from '../test/committedData.ts';

const withPeriod = (period: HeritageSiteProperties['period']) => ({ period });

describe('periodBucket', () => {
  it('uses the year when present', () => {
    expect(periodBucket(withPeriod({ label: '1010', year: 1010, source: 'x' }))).toBe('c11');
    expect(periodBucket(withPeriod({ label: '1900', year: 1900, source: 'x' }))).toBe('c19');
    expect(periodBucket(withPeriod({ label: '650', year: 650, source: 'x' }))).toBe('c7');
  });
  it('parses explicit century and decade labels only', () => {
    expect(periodBucket(withPeriod({ label: '8th century', year: null, source: 'x' }))).toBe('c8');
    expect(periodBucket(withPeriod({ label: '1650s', year: null, source: 'x' }))).toBe('c17');
    expect(periodBucket(withPeriod({ label: '57', year: null, source: 'x' }))).toBe('dated-other');
    expect(periodBucket(withPeriod(null))).toBe('unknown');
  });
  it('labels buckets', () => {
    expect(periodBucketLabel('c11')).toBe('11th century CE');
    expect(periodBucketLabel('c21')).toBe('21st century CE');
    expect(periodBucketLabel('c12')).toBe('12th century CE');
    expect(periodBucketLabel('unknown')).toBe('Period unknown');
  });
  it('lists options chronologically with unknown last and counts summing to the input', () => {
    const features = committedFeatures();
    const opts = periodOptions(features);
    expect(opts[opts.length - 1]?.bucket).toBe('unknown');
    expect(opts.reduce((s, o) => s + o.count, 0)).toBe(features.length);
  });
});

describe('search and filters on the committed Tamil Nadu data', () => {
  const features = committedFeatures();

  it('defaults to verified records only', () => {
    const verified = features.filter((f) => f.properties.verificationStatus === 'verified').length;
    expect(filterSites(features, DEFAULT_FILTERS)).toHaveLength(verified);
    expect(filterSites(features, { ...DEFAULT_FILTERS, includeUnverified: true })).toHaveLength(features.length);
  });

  it('matches name, district, category and state, ignoring case and diacritics', () => {
    const p = featureById('wd-Q916943').properties; // Prahadisvarar Temple, Thanjavur
    expect(matchesQuery(p, 'prahadisvarar')).toBe(true);
    expect(matchesQuery(p, 'THANJAVUR temple')).toBe(true);
    expect(matchesQuery(p, 'tamil nadu')).toBe(true);
    expect(matchesQuery(p, 'fort')).toBe(false);
    expect(matchesQuery(p, 'unesco')).toBe(true);
  });

  it('narrows by district text', () => {
    const res = filterSites(features, { ...DEFAULT_FILTERS, query: 'Thanjavur' });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((f) => /thanjavur/i.test(`${f.properties.name} ${f.properties.district}`))).toBe(true);
  });

  it('filters by category, UNESCO and period', () => {
    const forts = filterSites(features, { ...DEFAULT_FILTERS, categories: ['fort'] });
    expect(forts.length).toBeGreaterThan(0);
    expect(forts.every((f) => f.properties.category === 'fort')).toBe(true);

    // Great Living Chola Temples is unverified (coordinate-conflict between its sources), so include unverified.
    const unesco = filterSites(features, { ...DEFAULT_FILTERS, unescoOnly: true, includeUnverified: true });
    expect(unesco.map((f) => f.properties.id)).toContain('wd-Q695229'); // Great Living Chola Temples
    expect(unesco.every((f) => f.properties.unesco !== null)).toBe(true);

    const c11 = filterSites(features, { ...DEFAULT_FILTERS, periods: ['c11'] });
    expect(c11.map((f) => f.properties.id)).toContain('wd-Q916943'); // inception 1010
    expect(c11.every((f) => periodBucket(f.properties) === 'c11')).toBe(true);
  });

  it('toggles values in a list', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});
