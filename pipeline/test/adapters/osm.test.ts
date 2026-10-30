import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, createOsmAdapter, elementPosition, matchesFilters, osmWikidataTag } from '../../src/adapters/osm.ts';
import { getSource } from '../../src/config.ts';
import { config, OSM_FETCHED, overpassPayloads, tamilNadu } from '../helpers.ts';

const source = getSource(config, 'osm-overpass');
const cfg = source.overpass!;
const records = createOsmAdapter(source, config.categories).normalize(overpassPayloads(), tamilNadu);
const byKey = new Map(records.map((r) => [r.key, r]));

describe('Overpass query', () => {
  it('is built from config tag filters inside the state ISO area', () => {
    const q = buildOverpassQuery(tamilNadu, cfg);
    expect(q).toContain('area["ISO3166-2"="IN-TN"]->.searchArea;');
    expect(q).toContain('nwr["historic"="fort"](area.searchArea);');
    expect(q).toContain('nwr["tourism"="museum"](area.searchArea);');
    expect(q).toContain('nwr["amenity"="place_of_worship"]["historic"]["historic"!~"^(memorial|boundary_stone|wayside_cross|wayside_shrine|milestone)$"](area.searchArea);');
    expect(q).toContain('out center tags;');
  });
  it('applies the same exclusions when normalizing', () => {
    expect(matchesFilters({ amenity: 'place_of_worship', historic: 'yes' }, cfg)).toBe(true);
    expect(matchesFilters({ amenity: 'place_of_worship', historic: 'memorial' }, cfg)).toBe(false);
    expect(matchesFilters({ amenity: 'place_of_worship' }, cfg)).toBe(false);
    expect(matchesFilters({ tourism: 'museum', historic: 'memorial' }, cfg)).toBe(true);
    expect(matchesFilters({ historic: 'boundary_stone' }, cfg)).toBe(false);
  });
});

describe('OSM normalize', () => {
  it('uses node lat/lon', () => {
    const r = byKey.get('osm-node-1669711997')!;
    expect(r).toMatchObject({ name: 'Thirumayam Fort', lon: 78.7514866, lat: 10.2475835, category: 'fort', wikidataQid: 'Q7785352' });
    expect(r.sourceRef).toEqual({
      name: 'osm-overpass',
      id: 'node/1669711997',
      url: 'https://www.openstreetmap.org/node/1669711997',
      license: 'ODbL-1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      retrievedAt: OSM_FETCHED,
    });
  });
  it('uses the way centre and keeps the wikidata tag for dedupe', () => {
    const r = byKey.get('osm-way-379493148')!;
    expect(r).toMatchObject({ name: 'Delhi Gate', lon: 79.337784, lat: 12.9074698, category: 'monument', wikidataQid: 'Q97481253' });
    expect(elementPosition({ type: 'way', id: 1, center: { lat: 1, lon: 2 } })).toEqual([2, 1]);
    expect(elementPosition({ type: 'relation', id: 1 })).toBeNull();
  });
  it('maps categories from tags and prefers name:en', () => {
    expect(byKey.get('osm-node-4439102110')!.category).toBe('temple');
    expect(byKey.get('osm-node-7100854585')!).toMatchObject({ name: 'Government Museum - Madurai', category: 'museum' });
  });
  it('skips unnamed elements', () => {
    expect(byKey.has('osm-node-1223934145')).toBe(false);
    expect(byKey.has('osm-node-1152517547')).toBe(false);
    expect(records).toHaveLength(6);
  });
  it('reads the first valid QID from the wikidata tag', () => {
    expect(osmWikidataTag({ wikidata: 'Q1;Q2' })).toBe('Q1');
    expect(osmWikidataTag({ wikidata: 'bad' })).toBeNull();
    expect(osmWikidataTag({})).toBeNull();
  });
});
