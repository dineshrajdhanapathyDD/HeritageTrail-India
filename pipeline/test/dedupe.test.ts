import { describe, expect, it } from 'vitest';
import { dedupe, mergedCategory, sourcesAgree } from '../src/dedupe.ts';
import { candidate, eastOf } from './helpers.ts';

const LON = 79;
const LAT = 11;

describe('dedupe (decision 15)', () => {
  it('(a) merges an OSM element into the Wikidata item named by its wikidata tag', () => {
    const wd = candidate({ key: 'wd-Q97481253', name: 'Delhi Gate' });
    const osm = candidate({ key: 'osm-way-379493148', name: 'Delhi Gate (Arcot)', wikidataQid: 'Q97481253', lon: eastOf(LON, LAT, 0.04) });
    const { records, stats } = dedupe([osm, wd]);
    expect(records).toHaveLength(1);
    expect(records[0]!.primary.key).toBe('wd-Q97481253');
    expect(records[0]!.members.map((m) => m.key)).toEqual(['osm-way-379493148']);
    expect(stats.mergedByWikidataTag).toBe(1);
    expect(sourcesAgree(records[0]!)).toBe(true);
  });

  it('(b) merges the same normalized name within 300 m, Wikidata coordinates win', () => {
    const wd = candidate({ key: 'wd-Q113992715', name: 'Government Museum, Madurai', category: 'museum' });
    const osm = candidate({ key: 'osm-node-7100854585', name: 'Government Museum - Madurai', category: 'museum', lon: eastOf(LON, LAT, 0.25) });
    const { records, stats } = dedupe([wd, osm]);
    expect(records).toHaveLength(1);
    expect(records[0]!.primary.lon).toBe(LON);
    expect(stats.mergedByName).toBe(1);
  });

  it('(b) does not merge the same name beyond 300 m', () => {
    const a = candidate({ key: 'osm-node-1', name: 'Siva Temple' });
    const b = candidate({ key: 'osm-node-2', name: 'Siva Temple', lon: eastOf(LON, LAT, 0.4) });
    expect(dedupe([a, b]).records).toHaveLength(2);
  });

  it('(b) never merges two distinct Wikidata items; flags them as possible duplicates', () => {
    const a = candidate({ key: 'wd-Q1', name: 'Jain Temple' });
    const b = candidate({ key: 'wd-Q2', name: 'Jain temple', lon: eastOf(LON, LAT, 0.1) });
    const { records, stats } = dedupe([a, b]);
    expect(records).toHaveLength(2);
    expect([...records[0]!.flags]).toEqual(['possible-duplicate:wd-Q2']);
    expect([...records[1]!.flags]).toEqual(['possible-duplicate:wd-Q1']);
    expect(stats.possibleDuplicatePairs).toBe(1);
  });

  it('(c) flags different names within 50 m and the same category, without merging', () => {
    const a = candidate({ key: 'osm-node-10', name: 'Kodikal Mandapam', category: 'monument' });
    const b = candidate({ key: 'wd-Q97479652', name: 'Kotikal Mandapa', category: 'monument', lon: eastOf(LON, LAT, 0.03) });
    const c = candidate({ key: 'osm-node-11', name: 'Tirmurthy Cave', category: 'archaeological-site', lon: eastOf(LON, LAT, 0.02) });
    const { records } = dedupe([a, b, c]);
    expect(records).toHaveLength(3);
    const flags = Object.fromEntries(records.map((r) => [r.primary.key, [...r.flags]]));
    expect(flags['osm-node-10']).toEqual(['possible-duplicate:wd-Q97479652']);
    expect(flags['wd-Q97479652']).toEqual(['possible-duplicate:osm-node-10']);
    expect(flags['osm-node-11']).toEqual([]);
  });

  it('(c) does not flag different names more than 50 m apart', () => {
    const a = candidate({ key: 'osm-node-20', name: 'North Gate', category: 'fort' });
    const b = candidate({ key: 'osm-node-21', name: 'South Gate', category: 'fort', lon: eastOf(LON, LAT, 0.08) });
    const { records, stats } = dedupe([a, b]);
    expect(records).toHaveLength(2);
    expect(records.flatMap((r) => [...r.flags])).toEqual([]);
    expect(stats.possibleDuplicatePairs).toBe(0);
  });
  it('does not flag coordinate-conflict when merged members are within 500 m', () => {
    const wd = candidate({ key: 'wd-Q7', name: 'Old Gate', category: 'fort' });
    const osm = candidate({ key: 'osm-node-7', name: 'Old Gate', category: 'fort', wikidataQid: 'Q7', lon: eastOf(LON, LAT, 0.45) });
    const { records } = dedupe([wd, osm]);
    expect(records).toHaveLength(1);
    expect([...records[0]!.flags]).toEqual([]);
    expect(sourcesAgree(records[0]!)).toBe(true);
  });
  it('flags coordinate-conflict when a merged member is more than 500 m away', () => {
    const wd = candidate({ key: 'wd-Q471838', name: 'Sankagiri Fort', category: 'fort' });
    const osm = candidate({ key: 'osm-node-7689382152', name: 'Sankagiri Fort', category: 'fort', wikidataQid: 'Q471838', lon: eastOf(LON, LAT, 49) });
    const { records, stats } = dedupe([wd, osm]);
    expect(records).toHaveLength(1);
    expect([...records[0]!.flags]).toEqual(['coordinate-conflict']);
    expect(stats.coordinateConflicts).toBe(1);
    expect(sourcesAgree(records[0]!)).toBe(false);
  });

  it('takes a specific category from a member when the primary is "other"', () => {
    const wd = candidate({ key: 'wd-Q5', name: 'Old Fort', category: 'other' });
    const osm = candidate({ key: 'osm-way-5', name: 'Old Fort', category: 'fort', wikidataQid: 'Q5' });
    expect(mergedCategory(dedupe([wd, osm]).records[0]!)).toBe('fort');
  });

  it('is independent of input order', () => {
    const items = [
      candidate({ key: 'osm-node-3', name: 'Fort', category: 'fort' }),
      candidate({ key: 'wd-Q9', name: 'Fort', category: 'fort', lon: eastOf(LON, LAT, 0.1) }),
      candidate({ key: 'osm-node-4', name: 'Gate', category: 'fort', lon: eastOf(LON, LAT, 0.01) }),
    ];
    const summary = (xs: typeof items) =>
      dedupe(xs).records.map((r) => [r.primary.key, r.members.map((m) => m.key), [...r.flags].sort()]);
    expect(summary([...items].reverse())).toEqual(summary(items));
  });
});
