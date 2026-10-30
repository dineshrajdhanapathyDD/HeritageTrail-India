import { describe, expect, it } from 'vitest';
import { haversineKm, isInIndiaBbox, normalizeName } from '../src/geo.ts';
import { SITE_ID_REGEX, osmId, wikidataId } from '../src/ids.ts';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm([80.2707, 13.0827], [80.2707, 13.0827])).toBe(0);
  });

  it('is symmetric', () => {
    const a = [80.2707, 13.0827] as const;
    const b = [79.1378, 10.7828] as const;
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('matches one degree of latitude (about 111.2 km)', () => {
    expect(haversineKm([78, 10], [78, 11])).toBeCloseTo(111.19, 1);
  });

  it('shrinks longitude degrees with latitude', () => {
    expect(haversineKm([0, 60], [1, 60])).toBeCloseTo(55.6, 0);
  });
});

describe('isInIndiaBbox', () => {
  it('accepts points in Tamil Nadu', () => {
    expect(isInIndiaBbox(79.3378, 12.9075)).toBe(true);
  });

  it('accepts the bbox edges', () => {
    expect(isInIndiaBbox(68.0, 6.0)).toBe(true);
    expect(isInIndiaBbox(97.5, 37.5)).toBe(true);
  });

  it('rejects points outside the bbox', () => {
    expect(isInIndiaBbox(67.9, 20)).toBe(false);
    expect(isInIndiaBbox(80, 5.9)).toBe(false);
    expect(isInIndiaBbox(97.6, 20)).toBe(false);
    expect(isInIndiaBbox(80, 37.6)).toBe(false);
  });

  it('rejects swapped lat/lon and non-finite values', () => {
    expect(isInIndiaBbox(12.9075, 79.3378)).toBe(false);
    expect(isInIndiaBbox(Number.NaN, 12)).toBe(false);
    expect(isInIndiaBbox(80, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('normalizeName', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeName('Tamil Nādu')).toBe('tamil nadu');
  });

  it('removes punctuation and collapses whitespace', () => {
    expect(normalizeName('  Gingee Fort:  Rajagiri   Fort ')).toBe('gingee fort rajagiri fort');
    expect(normalizeName("St. Mary's Church, Chennai")).toBe('st mary s church chennai');
  });

  it('keeps non-Latin letters', () => {
    expect(normalizeName('தஞ்சாவூர்')).not.toBe('');
  });
});

describe('ids', () => {
  it('builds Wikidata ids from QIDs and entity URLs', () => {
    expect(wikidataId('Q1445')).toBe('wd-Q1445');
    expect(wikidataId('http://www.wikidata.org/entity/Q7785352')).toBe('wd-Q7785352');
    expect(() => wikidataId('P1371')).toThrow();
  });

  it('builds OSM ids', () => {
    expect(osmId('node', 1669711997)).toBe('osm-node-1669711997');
    expect(() => osmId('way', 'abc')).toThrow();
  });

  it('matches only URL-safe site ids', () => {
    expect(SITE_ID_REGEX.test('wd-Q1')).toBe(true);
    expect(SITE_ID_REGEX.test('osm-relation-42')).toBe(true);
    expect(SITE_ID_REGEX.test('osm-area-42')).toBe(false);
    expect(SITE_ID_REGEX.test('wd-Q1/../x')).toBe(false);
  });
});
