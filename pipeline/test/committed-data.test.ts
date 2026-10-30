import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HeritageCollection } from '@heritagetrail/shared';
import { pathsFor, REPO_ROOT } from '../src/paths.ts';
import { CONTACT_TAG_RE } from '../src/rawStore.ts';

const paths = pathsFor(REPO_ROOT);
const readJson = (f: string) => JSON.parse(readFileSync(join(paths.processedDir, f), 'utf8'));

describe('committed data/processed/tamil-nadu.geojson', () => {
  const fc = HeritageCollection.parse(readJson('tamil-nadu.geojson'));
  const report = readJson('tamil-nadu.report.json');

  it('validates against the shared schema', () => {
    expect(fc.metadata.stateCode).toBe('IN-TN');
    expect(fc.features.length).toBeGreaterThan(0);
  });

  it('gives every feature at least one source with url and licence', () => {
    for (const f of fc.features) {
      expect(f.properties.sources.length, f.properties.id).toBeGreaterThanOrEqual(1);
      for (const s of f.properties.sources) {
        expect(s.url, f.properties.id).toMatch(/^https:\/\/(www\.wikidata\.org\/wiki\/Q\d+|www\.openstreetmap\.org\/(node|way|relation)\/\d+)$/);
        expect(s.license, f.properties.id).toMatch(/^(CC0-1\.0|ODbL-1\.0)$/);
        expect(s.licenseUrl).toMatch(/^https:\/\//);
      }
      if (f.properties.image) {
        expect(f.properties.image.license).toBeTruthy();
        expect(f.properties.image.artist).toBeTruthy();
      }
    }
  });

  it('keeps only real sources (no UNESCO, ASI or Bhuvan data)', () => {
    const names = new Set(fc.features.flatMap((f) => f.properties.sources.map((s) => s.name)));
    expect([...names].sort()).toEqual(['osm-overpass', 'wikidata']);
    expect(fc.metadata.sources.map((s) => s.id)).not.toEqual(expect.arrayContaining(['unesco']));
  });

  it('never marks a coordinate-conflict record as verified', () => {
    const conflicts = fc.features.filter((f) => f.properties.flags.includes('coordinate-conflict'));
    expect(conflicts.length).toBeGreaterThan(0);
    for (const f of conflicts) expect(f.properties.verificationStatus, f.properties.id).toBe('unverified');
  });

  it('keeps no contact tags in the committed raw OSM copies', () => {
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'raw', 'tamil-nadu', 'osm-overpass', 'sites.json'), 'utf8'));
    const keys = raw.elements.flatMap((e: { tags?: Record<string, string> }) => Object.keys(e.tags ?? {}));
    expect(keys.filter((k: string) => CONTACT_TAG_RE.test(k))).toEqual([]);
  });

  it('matches its report and index', () => {
    expect(report.counts.published).toBe(fc.features.length);
    expect(report.counts.rejected).toBe(fc.metadata.counts.rejected);
    for (const r of report.rejected) expect(r.reason).toMatch(/^(missing-name|missing-coordinates|outside-india-bbox|outside-claimed-state)$/);
    expect(report.asiCoverage.asiPublishedCount).toBe(412);
    expect(report.districts.actual).toBe(38);
    const index = readJson('index.json');
    expect(index).toContainEqual(
      expect.objectContaining({ slug: 'tamil-nadu', featureCount: fc.metadata.counts.total, verifiedCount: fc.metadata.counts.verified }),
    );
  });
});
