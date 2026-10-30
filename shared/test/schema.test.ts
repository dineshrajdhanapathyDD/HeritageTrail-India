import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CategoriesConfig, SourcesConfig, StateConfig } from '../src/config.ts';
import { Flag, HeritageCollection, HeritageFeature, type HeritageFeature as Feature } from '../src/schema.ts';

const readConfig = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../config/${rel}`, import.meta.url), 'utf8'));

// Name, ASI ID, coordinates and district come from the verified sample row in docs/DATASETS.md
// (Delhi Gate, N-TN-C213). The QID Q100000001, image URL and artist are test placeholders, not real data.
const validFeature = (): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [79.3378, 12.9075] },
  properties: {
    id: 'wd-Q100000001',
    name: 'Delhi Gate',
    state: 'Tamil Nadu',
    stateCode: 'IN-TN',
    district: 'Ranipet',
    category: 'monument',
    unesco: null,
    unescoWhsId: null,
    unescoUrl: null,
    designations: ['Monument of National Importance'],
    asiMonumentId: 'N-TN-C213',
    period: null,
    description: null,
    image: {
      url: 'https://upload.wikimedia.org/example.jpg',
      thumbUrl: null,
      filePageUrl: 'https://commons.wikimedia.org/wiki/File:Delhi_gate_-_river_side_view.jpg',
      license: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
      artist: 'Example author',
      credit: 'Own work',
    },
    sources: [
      {
        name: 'wikidata',
        id: 'Q100000001',
        url: 'https://www.wikidata.org/wiki/Q100000001',
        license: 'CC0-1.0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        retrievedAt: '2026-10-30T07:00:00Z',
      },
    ],
    license: 'CC0-1.0',
    verificationStatus: 'verified',
    flags: ['missing-period', 'missing-description'],
  },
});

const collectionOf = (features: Feature[]) => ({
  type: 'FeatureCollection' as const,
  metadata: {
    state: 'Tamil Nadu',
    stateCode: 'IN-TN',
    dataRetrievedAt: '2026-10-30T07:00:00Z',
    sources: [
      {
        id: 'wikidata',
        name: 'Wikidata Query Service',
        url: 'https://query.wikidata.org/sparql',
        license: 'CC0-1.0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        recordCount: features.length,
      },
    ],
    attribution: ['Wikidata (structured data, CC0 1.0)'],
    databaseLicense: 'ODbL-1.0',
    counts: {
      total: features.length,
      verified: features.filter((f) => f.properties.verificationStatus === 'verified').length,
      unverified: features.filter((f) => f.properties.verificationStatus === 'unverified').length,
      rejected: 0,
      byCategory: { monument: features.length },
    },
  },
  features,
});

describe('HeritageFeature', () => {
  it('accepts a complete record', () => {
    expect(HeritageFeature.safeParse(validFeature()).success).toBe(true);
  });

  it('rejects a record without sources', () => {
    const f = validFeature();
    f.properties.sources = [];
    expect(HeritageFeature.safeParse(f).success).toBe(false);
  });

  it('rejects coordinates outside India (including swapped lat/lon)', () => {
    const f = validFeature();
    f.geometry.coordinates = [12.9075, 79.3378];
    expect(HeritageFeature.safeParse(f).success).toBe(false);
  });

  it('rejects unknown categories, bad ids and bad state codes', () => {
    const badCategory = validFeature() as unknown as { properties: Record<string, unknown> };
    badCategory.properties.category = 'palace';
    expect(HeritageFeature.safeParse(badCategory).success).toBe(false);

    const badId = validFeature();
    badId.properties.id = 'Q123';
    expect(HeritageFeature.safeParse(badId).success).toBe(false);

    const badState = validFeature();
    badState.properties.stateCode = 'TN';
    expect(HeritageFeature.safeParse(badState).success).toBe(false);
  });

  it('rejects a source without a licence URL', () => {
    const f = validFeature() as unknown as { properties: { sources: Array<Record<string, unknown>> } };
    delete f.properties.sources[0]!.licenseUrl;
    expect(HeritageFeature.safeParse(f).success).toBe(false);
  });

  it('allows a public-domain image without licence URL but requires an artist', () => {
    const pd = validFeature();
    pd.properties.image = { ...pd.properties.image!, license: 'Public domain', licenseUrl: null };
    expect(HeritageFeature.safeParse(pd).success).toBe(true);

    const noArtist = validFeature();
    noArtist.properties.image = { ...noArtist.properties.image!, artist: '' };
    expect(HeritageFeature.safeParse(noArtist).success).toBe(false);
  });
});

describe('Flag', () => {
  it('accepts known flags and possible-duplicate with a site id', () => {
    expect(Flag.safeParse('district-derived').success).toBe(true);
    expect(Flag.safeParse('possible-duplicate:osm-way-123').success).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(Flag.safeParse('looks-fine').success).toBe(false);
    expect(Flag.safeParse('possible-duplicate:abc').success).toBe(false);
  });
});

describe('HeritageCollection', () => {
  it('accepts a consistent collection', () => {
    const result = HeritageCollection.safeParse(collectionOf([validFeature()]));
    expect(result.success).toBe(true);
  });

  it('rejects rejected records, duplicate ids and wrong counts', () => {
    const rejected = validFeature();
    rejected.properties.verificationStatus = 'rejected';
    expect(HeritageCollection.safeParse(collectionOf([rejected])).success).toBe(false);

    expect(HeritageCollection.safeParse(collectionOf([validFeature(), validFeature()])).success).toBe(false);

    const wrongCount = collectionOf([validFeature()]);
    wrongCount.metadata.counts.total = 2;
    wrongCount.metadata.counts.verified = 2;
    expect(HeritageCollection.safeParse(wrongCount).success).toBe(false);
  });
});

describe('config files', () => {
  it('config/sources.json is valid', () => {
    const parsed = SourcesConfig.parse(readConfig('sources.json'));
    expect(parsed.sources.map((s) => s.id)).toEqual([
      'wikidata',
      'osm-overpass',
      'commons',
      'geoboundaries-adm1',
      'geoboundaries-adm2',
    ]);
  });

  it('config/categories.json is valid and checks museums first', () => {
    const parsed = CategoriesConfig.parse(readConfig('categories.json'));
    expect(parsed.rules[0]!.category).toBe('museum');
    expect(parsed.fallback).toBe('other');
  });

  it('config/states/tamil-nadu.json is valid', () => {
    const parsed = StateConfig.parse(readConfig('states/tamil-nadu.json'));
    expect(parsed.code).toBe('IN-TN');
    expect(parsed.asiCentrallyProtected?.count).toBe(412);
  });
});
