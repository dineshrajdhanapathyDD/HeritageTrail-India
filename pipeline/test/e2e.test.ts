import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HeritageCollection } from '@heritagetrail/shared';
import { buildCommonsBatches } from '../src/adapters/commons.ts';
import { buildOverpassRequest } from '../src/adapters/osm.ts';
import { buildWikidataRequest, createWikidataAdapter } from '../src/adapters/wikidata.ts';
import { getSource } from '../src/config.ts';
import { pathsFor, rawStateDir, REPO_ROOT } from '../src/paths.ts';
import { RawStore } from '../src/rawStore.ts';
import { runState } from '../src/run.ts';
import { config, fixtureText, OSM_FETCHED, tamilNadu, WD_FETCHED, wikidataPayloads } from './helpers.ts';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A throwaway repo root with the real config + committed boundaries and fixture raw copies. */
function makeRoot(opts: { overpassFails?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'heritagetrail-pipeline-'));
  roots.push(root);
  cpSync(join(REPO_ROOT, 'config'), join(root, 'config'), { recursive: true });
  for (const f of ['india-states.geojson', 'tamil-nadu-state.geojson', 'tamil-nadu-districts.geojson']) {
    cpSync(join(REPO_ROOT, 'data/processed/boundaries', f), join(root, 'data/processed/boundaries', f));
  }
  const paths = pathsFor(root);
  const store = new RawStore(rawStateDir(paths, 'tamil-nadu'));
  const wd = getSource(config, 'wikidata');
  for (const n of ['asi', 'museums', 'whs'] as const) {
    store.record(buildWikidataRequest(wd, n, tamilNadu), WD_FETCHED, { body: fixtureText(`wikidata-${n}.json`), status: 200 });
  }
  const osmReq = buildOverpassRequest(getSource(config, 'osm-overpass'), tamilNadu);
  if (opts.overpassFails) store.record(osmReq, OSM_FETCHED, { error: 'HTTP 504 from overpass-api.de after 3 attempts', status: 504 });
  else store.record(osmReq, OSM_FETCHED, { body: fixtureText('overpass-sites.json'), status: 200 });
  const files = createWikidataAdapter(wd, config.categories)
    .normalize(wikidataPayloads(), tamilNadu)
    .map((r) => r.imageFile)
    .filter((f): f is string => !!f);
  const [batch] = buildCommonsBatches(getSource(config, 'commons'), files);
  store.record(batch!.request, '2026-10-30T08:14:57.922Z', { body: fixtureText('commons-imageinfo.json'), status: 200 });
  store.save();
  return paths;
}

const read = (paths: ReturnType<typeof pathsFor>, f: string) => readFileSync(join(paths.processedDir, f), 'utf8');

describe('end-to-end offline run on fixtures', async () => {
  const paths = makeRoot();
  await runState('tamil-nadu', { paths, offline: true });
  const geojson = read(paths, 'tamil-nadu.geojson');
  const reportText = read(paths, 'tamil-nadu.report.json');
  const indexText = read(paths, 'index.json');
  const fc = HeritageCollection.parse(JSON.parse(geojson));
  const report = JSON.parse(reportText);
  const byId = new Map(fc.features.map((f) => [f.properties.id, f.properties]));

  it('publishes schema-valid records with provenance on every feature', () => {
    expect(fc.features).toHaveLength(12);
    for (const f of fc.features) {
      expect(f.properties.sources.length).toBeGreaterThan(0);
      for (const s of f.properties.sources) expect(s.url && s.license && s.licenseUrl).toBeTruthy();
    }
    expect(fc.metadata.dataRetrievedAt).toBe('2026-10-30T08:14:57.922Z');
    expect(fc.metadata.counts).toMatchObject({ total: 12, rejected: 1 });
  });

  it('merges across sources and sets verification status', () => {
    expect(byId.get('wd-Q97481253')).toMatchObject({ verificationStatus: 'verified', district: 'Ranipet', license: 'ODbL-1.0' });
    expect(byId.get('wd-Q97481253')!.sources).toHaveLength(2);
    expect(byId.get('wd-Q113992715')).toMatchObject({ verificationStatus: 'verified', category: 'museum' });
    expect(byId.has('osm-node-7100854585')).toBe(false);
    expect(byId.get('wd-Q471838')!.flags).toContain('coordinate-conflict');
    expect(byId.get('osm-node-1669711997')).toMatchObject({ verificationStatus: 'unverified', name: 'Thirumayam Fort' });
    expect(byId.get('wd-Q3437182')).toMatchObject({ unesco: 'component', unescoUrl: 'https://whc.unesco.org/en/list/250' });
    expect(byId.get('wd-Q3437182')!.image?.license).toBe('CC BY-SA 3.0');
  });

  it('reports rejected records with reasons, flags and the ASI coverage gap', () => {
    expect(report.rejected).toEqual([
      expect.objectContaining({ id: 'wd-Q4527', name: 'Western Ghats', reason: 'outside-claimed-state', detectedState: 'Kerala' }),
    ]);
    expect(report.flags['coordinate-conflict']).toBe(1);
    expect(report.asiCoverage).toMatchObject({ asiPublishedCount: 412, distinctCentralAsiIds: 5, missing: 407 });
    expect(report.coordinateConflicts[0]).toMatchObject({ id: 'wd-Q471838', others: [expect.objectContaining({ ref: 'node/7689382152' })] });
    expect(report.sourceFailures).toEqual([]);
    expect(JSON.parse(indexText)).toEqual([expect.objectContaining({ slug: 'tamil-nadu', featureCount: 12 })]);
  });

  it('is deterministic: a second offline run reproduces every file byte for byte', async () => {
    await runState('tamil-nadu', { paths, offline: true });
    expect(read(paths, 'tamil-nadu.geojson')).toBe(geojson);
    expect(read(paths, 'tamil-nadu.report.json')).toBe(reportText);
    expect(read(paths, 'index.json')).toBe(indexText);
  });
});

describe('source failure handling', () => {
  it('continues without Overpass and records the failure', async () => {
    const paths = makeRoot({ overpassFails: true });
    const { collection, report } = await runState('tamil-nadu', { paths, offline: true });
    expect(report.sourceFailures).toEqual([
      { source: 'osm-overpass', request: 'sites', status: 504, error: 'HTTP 504 from overpass-api.de after 3 attempts' },
    ]);
    expect(collection.features.every((f) => f.properties.sources.every((s) => s.name === 'wikidata'))).toBe(true);
    expect(collection.metadata.sources.map((s) => s.id)).not.toContain('osm-overpass');
    expect(collection.metadata.databaseLicense).toBe('CC0-1.0');
  });

  it('refuses offline raw copies fetched with a different request', async () => {
    const paths = makeRoot();
    const store = new RawStore(rawStateDir(paths, 'tamil-nadu'));
    const req = buildWikidataRequest(getSource(config, 'wikidata'), 'asi', { ...tamilNadu, wikidataQid: 'Q1' });
    expect(() => store.read(req)).toThrow(/different request/);
  });
});
