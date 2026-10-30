import { describe, expect, it } from 'vitest';
import { HeritageCollection, HeritageFeature } from '@heritagetrail/shared';
import type { ImageResolution } from '../src/adapters/commons.ts';
import { getSource } from '../src/config.ts';
import { dedupe } from '../src/dedupe.ts';
import { serializeFeatureCollection } from '../src/geojson.ts';
import { buildCollection, buildFeature, buildReport, sortFlags, type BuildInput } from '../src/output.ts';
import { candidate, config, eastOf, syntheticGeometry } from './helpers.ts';

const geo = syntheticGeometry();
const image: ImageResolution = {
  ok: true,
  image: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Delhi_gate_-_river_side_view.jpg',
    thumbUrl: null,
    filePageUrl: 'https://commons.wikimedia.org/wiki/File:Delhi_gate_-_river_side_view.jpg',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
    artist: 'Priasai',
    credit: 'Own work',
  },
};

function build() {
  const { records, stats } = dedupe([
    candidate({
      key: 'wd-Q97481253',
      name: 'Delhi Gate',
      category: 'monument',
      districtClaim: 'Kanchipuram',
      asiIds: ['N-TN-C213'],
      designations: ['Monument of National Importance'],
      imageFile: 'Delhi gate - river side view.jpg',
      lon: 78.5,
      description: { text: 'gate in Arcot', source: 'https://www.wikidata.org/wiki/Q97481253', license: 'CC0-1.0' },
    }),
    candidate({ key: 'osm-way-379493148', name: 'Delhi Gate', wikidataQid: 'Q97481253', lon: eastOf(78.5, 11, 0.05) }),
    candidate({ key: 'osm-node-1', name: 'Lone Temple', lon: 79.5, locationFlags: ['boundary-tolerance'] }),
    candidate({ key: 'wd-Q2', name: 'WHS component', whsIds: ['250bis-003'], unesco: 'component', lon: 79.6 }),
  ]);
  const built = records.map((r) => buildFeature(r, geo, new Map([['Delhi gate - river side view.jpg', image]])));
  const input: BuildInput = {
    state: geo.state,
    built,
    rejected: [],
    candidateCounts: { wikidata: 2, 'osm-overpass': 2 },
    dedupe: stats,
    images: { requested: 1, kept: 1, dropped: [] },
    failures: [],
    usedSources: ['wikidata', 'osm-overpass', 'commons', 'geoboundaries-adm1', 'geoboundaries-adm2'].map((id) => getSource(config, id)),
    districtCount: { expected: 2, actual: 2, ok: true },
    districtsUsed: 2,
    dataRetrievedAt: '2026-10-30T08:14:57.922Z',
  };
  return { built, input };
}

describe('buildFeature', () => {
  const { built } = build();
  const byId = new Map(built.map((b) => [b.feature.properties.id, b.feature.properties]));

  it('produces schema-valid features with merged provenance', () => {
    for (const b of built) expect(HeritageFeature.safeParse(b.feature).success).toBe(true);
    const gate = byId.get('wd-Q97481253')!;
    expect(gate.sources.map((s) => `${s.name}:${s.id}`)).toEqual(['osm-overpass:way/379493148', 'wikidata:Q97481253']);
    expect(gate.license).toBe('ODbL-1.0');
    expect(gate.district).toBe('Kancheepuram');
    expect(gate.verificationStatus).toBe('verified');
    expect(gate.image?.artist).toBe('Priasai');
    expect(gate.flags).toEqual(['missing-period']);
  });
  it('marks single-source records without identifiers as unverified and flags gaps', () => {
    const lone = byId.get('osm-node-1')!;
    expect(lone.verificationStatus).toBe('unverified');
    expect(lone.license).toBe('ODbL-1.0');
    expect(lone.flags).toEqual(['missing-period', 'missing-description', 'missing-image', 'district-derived', 'boundary-tolerance']);
  });
  it('verifies WHS components and links the WHC page', () => {
    const whs = byId.get('wd-Q2')!;
    expect(whs).toMatchObject({ verificationStatus: 'verified', unesco: 'component', unescoUrl: 'https://whc.unesco.org/en/list/250', license: 'CC0-1.0' });
  });
});

describe('collection and report', () => {
  it('validates against the shared HeritageCollection schema', () => {
    const { input } = build();
    const fc = buildCollection(input);
    expect(HeritageCollection.safeParse(fc).success).toBe(true);
    expect(fc.metadata.counts).toEqual({ total: 3, verified: 2, unverified: 1, rejected: 0, byCategory: { temple: 2, monument: 1 } });
    expect(fc.metadata.databaseLicense).toBe('ODbL-1.0');
    expect(fc.metadata.sources.find((s) => s.id === 'osm-overpass')?.recordCount).toBe(2);
    expect(fc.features.map((f) => f.properties.id)).toEqual(['osm-node-1', 'wd-Q2', 'wd-Q97481253']);
    const report = buildReport(input, fc);
    expect(report.flags).toMatchObject({ 'missing-period': 3, 'boundary-tolerance': 1 });
    expect(report.asiCoverage).toMatchObject({ asiPublishedCount: 412, distinctCentralAsiIds: 1, missing: 411 });
  });
  it('serializes deterministically and round-trips', () => {
    const fc = buildCollection(build().input);
    const { features, type: _t, ...header } = fc;
    const text = serializeFeatureCollection(header, features);
    expect(JSON.parse(text)).toEqual(fc);
    expect(serializeFeatureCollection(header, features)).toBe(text);
    expect(text.split('\n').filter((l) => l.startsWith('    {"type":"Feature"'))).toHaveLength(3);
  });
  it('orders flags by the schema order, possible duplicates last', () => {
    expect(sortFlags(['possible-duplicate:wd-Q1', 'missing-image', 'missing-district', 'missing-image'])).toEqual([
      'missing-district',
      'missing-image',
      'possible-duplicate:wd-Q1',
    ]);
  });
});
