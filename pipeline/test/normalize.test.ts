import { describe, expect, it } from 'vitest';
import { categorize, periodFromOsmStartDate, periodFromWikidata, recordLicense, stripDistrictSuffix } from '../src/normalize.ts';
import { candidate, config } from './helpers.ts';

describe('categorize (config/categories.json)', () => {
  const cat = (wikidataLabels: string[]) => categorize(config.categories, { wikidataLabels });
  it('maps Wikidata P31 labels by ordered keyword rules', () => {
    expect(cat(['Hindu temple'])).toBe('temple');
    expect(cat(['fort', 'museum'])).toBe('museum'); // museum rule comes first
    expect(cat(['city gate'])).toBe('monument');
    expect(cat(['rock-cut architecture'])).toBe('archaeological-site');
    expect(cat(['dolmen'])).toBe('archaeological-site');
    expect(cat(['sculpture'])).toBe('other');
    expect(cat([])).toBe('other');
  });
  it('maps OSM tags', () => {
    const osm = (osmTags: Record<string, string>) => categorize(config.categories, { osmTags });
    expect(osm({ tourism: 'museum', historic: 'fort' })).toBe('museum');
    expect(osm({ historic: 'castle' })).toBe('fort');
    expect(osm({ amenity: 'place_of_worship', historic: 'yes' })).toBe('temple');
    expect(osm({ historic: 'archaeological_site' })).toBe('archaeological-site');
    expect(osm({ historic: 'monument' })).toBe('monument');
    expect(osm({ historic: 'yes' })).toBe('other');
  });
});

describe('periods', () => {
  it('uses the finest Wikidata precision and labels coarser precision honestly', () => {
    expect(periodFromWikidata([{ time: '1010-01-01T00:00:00Z', precision: 9 }])).toEqual({
      label: '1010',
      year: 1010,
      source: 'Wikidata P571 (inception)',
    });
    expect(periodFromWikidata([{ time: '0701-01-01T00:00:00Z', precision: 7 }])?.label).toBe('8th century');
    expect(periodFromWikidata([{ time: '1100-01-01T00:00:00Z', precision: 7 }])?.label).toBe('11th century');
    expect(periodFromWikidata([{ time: '1850-01-01T00:00:00Z', precision: 8 }])).toMatchObject({ label: '1850s', year: null });
    expect(
      periodFromWikidata([
        { time: '0701-01-01T00:00:00Z', precision: 7 },
        { time: '0732-01-01T00:00:00Z', precision: 9 },
      ])?.label,
    ).toBe('732');
    expect(periodFromWikidata([{ time: '-0300-01-01T00:00:00Z', precision: 9 }])).toBeNull();
    expect(periodFromWikidata([])).toBeNull();
  });
  it('parses common OSM start_date forms and keeps others verbatim', () => {
    expect(periodFromOsmStartDate('1789')).toEqual({ label: '1789', year: 1789, source: 'OpenStreetMap start_date' });
    expect(periodFromOsmStartDate('1789-05-01')?.year).toBe(1789);
    expect(periodFromOsmStartDate('C17')?.label).toBe('17th century');
    expect(periodFromOsmStartDate('1850s')?.label).toBe('1850s');
    expect(periodFromOsmStartDate('~1650')).toMatchObject({ label: 'c. 1650', year: null });
    expect(periodFromOsmStartDate('early C12')).toMatchObject({ label: 'early C12', year: null });
    expect(periodFromOsmStartDate(undefined)).toBeNull();
  });
});

describe('record licence', () => {
  it('is ODbL when any OSM source contributed, else CC0', () => {
    const wd = candidate({ key: 'wd-Q1' }).sourceRef;
    const osm = candidate({ key: 'osm-node-1' }).sourceRef;
    expect(recordLicense([wd])).toBe('CC0-1.0');
    expect(recordLicense([wd, osm])).toBe('ODbL-1.0');
  });
  it('strips the district suffix', () => {
    expect(stripDistrictSuffix('Tiruvannamalai district')).toBe('Tiruvannamalai');
    expect(stripDistrictSuffix('Chennai')).toBe('Chennai');
  });
});
