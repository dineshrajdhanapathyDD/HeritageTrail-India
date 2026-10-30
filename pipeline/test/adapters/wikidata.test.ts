import { describe, expect, it } from 'vitest';
import {
  aggregateRows,
  buildSparql,
  buildWikidataRequest,
  commonsFileFromUri,
  createWikidataAdapter,
  parseWktPoint,
  unescoFromDesignations,
  unescoUrlFor,
} from '../../src/adapters/wikidata.ts';
import { getSource } from '../../src/config.ts';
import { config, tamilNadu, WD_FETCHED, wikidataPayloads } from '../helpers.ts';

const adapter = createWikidataAdapter(getSource(config, 'wikidata'), config.categories);
const records = adapter.normalize(wikidataPayloads(), tamilNadu);
const byKey = new Map(records.map((r) => [r.key, r]));

describe('parseWktPoint', () => {
  it('reads WKT Point(lon lat)', () => {
    expect(parseWktPoint('Point(79.3378 12.9075)')).toEqual([79.3378, 12.9075]);
    expect(parseWktPoint('Point(-0.5 1e1)')).toEqual([-0.5, 10]);
  });
  it('rejects non-Earth globes and malformed values', () => {
    expect(parseWktPoint('<http://www.wikidata.org/entity/Q405> Point(10 10)')).toBeNull();
    expect(parseWktPoint('Point(79.3)')).toBeNull();
    expect(parseWktPoint('')).toBeNull();
  });
});

describe('wikidata queries', () => {
  it('builds split SPARQL queries scoped to the state QID', () => {
    const q = buildSparql('?item wdt:P1371 [] .', 'Q1445');
    expect(q).toContain('wdt:P131* wd:Q1445');
    expect(q).toContain('wdt:P625 ?coord');
    expect(() => buildSparql('x', 'Q1445; DROP')).toThrow();
    const req = buildWikidataRequest(getSource(config, 'wikidata'), 'museums', tamilNadu);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://query.wikidata.org/sparql');
    expect(decodeURIComponent(req.body!.replace(/\+/g, ' '))).toContain('wdt:P31 wd:Q33506');
  });
});

describe('aggregateRows', () => {
  it('collapses repeated rows into one entry per QID across queries', () => {
    const aggs = aggregateRows(wikidataPayloads());
    // Airavatesvara Temple appears in both the ASI and the WHS query, on several rows.
    const a = aggs.get('Q3437182')!;
    expect(a.label).toBe('Airavatesvara Temple');
    expect([...a.heritage].sort()).toEqual(['Monument of National Importance', 'part of UNESCO World Heritage Site']);
    expect([...a.whs]).toEqual(['250bis-003']);
    expect(a.fetchedAt).toBe(WD_FETCHED);
    expect(aggs.size).toBe(10);
  });
});

describe('wikidata normalize', () => {
  it('maps a real ASI item to a candidate with provenance', () => {
    const r = byKey.get('wd-Q97481253')!;
    expect(r).toMatchObject({
      name: 'Delhi Gate',
      lon: 79.3378,
      lat: 12.9075,
      category: 'monument',
      districtClaim: 'Ranipet',
      asiIds: ['N-TN-C213'],
      imageFile: 'Delhi gate - river side view.jpg',
      description: { text: 'gate in Arcot, Ranipet district', source: 'https://www.wikidata.org/wiki/Q97481253', license: 'CC0-1.0' },
    });
    expect(r.sourceRef).toEqual({
      name: 'wikidata',
      id: 'Q97481253',
      url: 'https://www.wikidata.org/wiki/Q97481253',
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      retrievedAt: WD_FETCHED,
    });
  });
  it('derives UNESCO status from P1435 and the WHC URL from P757', () => {
    const r = byKey.get('wd-Q3437182')!;
    expect(r.unesco).toBe('component');
    expect(r.whsIds).toEqual(['250bis-003']);
    expect(r.period).toEqual({ label: '1166', year: 1166, source: 'Wikidata P571 (inception)' });
    expect(unescoUrlFor('250bis-003')).toBe('https://whc.unesco.org/en/list/250');
    expect(unescoUrlFor('1342rev-014')).toBe('https://whc.unesco.org/en/list/1342');
    expect(unescoUrlFor('x')).toBeNull();
    expect(unescoFromDesignations(['World Heritage Site'])).toBe('inscribed');
    expect(unescoFromDesignations(['Tentative World Heritage Site', 'part of UNESCO World Heritage Site'])).toBe('component');
    expect(unescoFromDesignations(['State Protected Monument'])).toBeNull();
  });
  it('leaves the district empty when Wikidata has no P131 district', () => {
    expect(byKey.get('wd-Q7809304')!.districtClaim).toBeNull();
  });
  it('decodes Commons file names from Special:FilePath URIs', () => {
    expect(commonsFileFromUri('http://commons.wikimedia.org/wiki/Special:FilePath/Delhi%20gate%20-%20river_side%20view.jpg')).toBe(
      'Delhi gate - river side view.jpg',
    );
    expect(commonsFileFromUri('http://example.org/x.jpg')).toBeNull();
  });
});
