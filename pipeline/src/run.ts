import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoriesConfig, SourceConfig, StateConfig } from '@heritagetrail/shared';
import {
  buildBoundaryOutputs,
  fetchBoundary,
  type BoundaryMetadata,
  type DistrictProps,
  type StateProps,
} from './adapters/boundaries.ts';
import { fetchCommonsImages, type ImageResolution } from './adapters/commons.ts';
import { createOsmAdapter } from './adapters/osm.ts';
import { SourceFetchError, type CandidateRecord, type SourceAdapter } from './adapters/types.ts';
import { createWikidataAdapter } from './adapters/wikidata.ts';
import { getSource, getState, loadConfig } from './config.ts';
import { dedupe, type LocatedCandidate } from './dedupe.ts';
import { serializeFeatureCollection, writeText, type AreaFeature } from './geojson.ts';
import type { HttpOptions } from './http.ts';
import { writeStateOutputs, type ImageStats, type RejectedRecord, type SourceFailure, buildFeature } from './output.ts';
import { rawStateDir, type PipelinePaths } from './paths.ts';
import { offlineFetcher, onlineFetcher, RawStore, type RawFetcher } from './rawStore.ts';
import { stateGeometry, validateLocation, type StateGeometry } from './validate.ts';

/** Site adapters by source id. A new site source = adapter factory here + entry in config/sources.json. */
export const SITE_ADAPTERS: Record<string, (s: SourceConfig, c: CategoriesConfig) => SourceAdapter> = {
  wikidata: createWikidataAdapter,
  'osm-overpass': createOsmAdapter,
};
export const ADM1_SOURCE = 'geoboundaries-adm1';
export const ADM2_SOURCE = 'geoboundaries-adm2';

export interface RunOptions {
  paths: PipelinePaths;
  offline: boolean;
  /** Restrict to these source ids (default: every enabled site and image source). */
  sources?: string[];
  http?: Omit<HttpOptions, 'userAgent'>;
  log?: (message: string) => void;
}

/** Wraps a fetcher and remembers the latest fetchedAt of successful responses. */
function tracking(inner: RawFetcher): RawFetcher & { latest: string | null } {
  const t = {
    offline: inner.offline,
    latest: null as string | null,
    async get(req: Parameters<RawFetcher['get']>[0]) {
      const res = await inner.get(req);
      if (res.ok && (t.latest === null || res.fetchedAt > t.latest)) t.latest = res.fetchedAt;
      return res;
    },
  };
  return t;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

interface BoundaryFile<P> {
  metadata: BoundaryMetadata & { districtCount?: { expected: number; actual: number; ok: boolean } };
  features: AreaFeature<P>[];
}

export function loadStateGeometry(paths: PipelinePaths, state: StateConfig) {
  const files = {
    india: join(paths.boundariesDir, 'india-states.geojson'),
    state: join(paths.boundariesDir, `${state.slug}-state.geojson`),
    districts: join(paths.boundariesDir, `${state.slug}-districts.geojson`),
  };
  for (const f of Object.values(files)) {
    if (!existsSync(f)) throw new Error(`Missing ${f}; run \`npm run pipeline -- boundaries\` first`);
  }
  const india = readJson<BoundaryFile<StateProps>>(files.india);
  const st = readJson<BoundaryFile<StateProps>>(files.state);
  const districts = readJson<BoundaryFile<DistrictProps>>(files.districts);
  const stateFeature = st.features[0];
  if (!stateFeature) throw new Error(`${files.state} has no feature`);
  return {
    geo: stateGeometry(state, stateFeature, districts.features, india.features),
    districtCount: districts.metadata.districtCount ?? {
      expected: state.expectedDistrictCount,
      actual: districts.features.length,
      ok: districts.features.length === state.expectedDistrictCount,
    },
  };
}

export async function runState(slug: string, opts: RunOptions) {
  const log = opts.log ?? (() => {});
  const config = loadConfig(opts.paths);
  const state = getState(config, slug);
  const { geo, districtCount } = loadStateGeometry(opts.paths, state);

  const wanted = (s: SourceConfig) => s.enabled && (!opts.sources || opts.sources.includes(s.id));
  const siteSources = config.sources.sources.filter((s) => s.kind === 'sites' && wanted(s));
  const imageSource = config.sources.sources.find((s) => s.kind === 'images' && wanted(s)) ?? null;
  for (const s of siteSources) if (!SITE_ADAPTERS[s.id]) throw new Error(`No adapter registered for source ${s.id}`);
  if (opts.sources) {
    const known = new Set(config.sources.sources.map((s) => s.id));
    const unknown = opts.sources.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`Unknown source id(s): ${unknown.join(', ')}`);
  }

  const store = new RawStore(rawStateDir(opts.paths, slug));
  if (!opts.offline) store.reset([...siteSources.map((s) => s.id), ...(imageSource ? [imageSource.id] : [])]);
  const fetcher = tracking(
    opts.offline
      ? offlineFetcher(store)
      : onlineFetcher(store, { ...opts.http, userAgent: config.sources.userAgent, log }),
  );

  const failures: SourceFailure[] = [];
  const candidates: CandidateRecord[] = [];
  const candidateCounts: Record<string, number> = {};
  const usedSources: SourceConfig[] = [];
  for (const source of siteSources) {
    const adapter = SITE_ADAPTERS[source.id]!(source, config.categories);
    log(`${source.id}: ${opts.offline ? 'reading raw copies' : 'fetching'}`);
    try {
      const raw = await adapter.fetch(state, fetcher);
      const records = adapter.normalize(raw, state);
      candidates.push(...records);
      candidateCounts[source.id] = records.length;
      usedSources.push(source);
      log(`${source.id}: ${records.length} candidate records`);
    } catch (err) {
      if (!(err instanceof SourceFetchError)) throw err;
      failures.push({ source: err.source, request: err.request, status: err.status, error: err.message });
      log(`${source.id}: FAILED (${err.message}); continuing with the remaining sources`);
    }
  }

  let images = new Map<string, ImageResolution>();
  const imageFiles = [...new Set(candidates.map((c) => c.imageFile).filter((f): f is string => !!f))];
  if (imageSource && imageFiles.length > 0) {
    log(`${imageSource.id}: resolving ${imageFiles.length} image licences`);
    const res = await fetchCommonsImages(imageSource, imageFiles, fetcher);
    images = res.images;
    for (const f of res.failures) failures.push({ source: imageSource.id, request: f.name, status: f.status, error: f.error });
    usedSources.push(imageSource);
  }
  usedSources.push(getSource(config, ADM1_SOURCE), getSource(config, ADM2_SOURCE));
  if (!opts.offline) store.save();

  const { located, rejected } = validateAll(candidates, geo);
  const { records, stats } = dedupe(located);
  const built = records.map((r) => buildFeature(r, geo, images));

  const imageStats: ImageStats = {
    requested: imageFiles.length,
    kept: [...images.values()].filter((r) => r.ok).length,
    dropped: [...images.entries()]
      .filter(([, r]) => !r.ok)
      .map(([file, r]) => ({ file, reason: r.ok ? '' : r.reason }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
  };
  const dataRetrievedAt = fetcher.latest;
  if (!dataRetrievedAt) throw new Error('No source returned data; nothing to publish');

  const result = writeStateOutputs(opts.paths, config, {
    state,
    built,
    rejected,
    candidateCounts,
    dedupe: stats,
    images: imageStats,
    failures,
    usedSources,
    districtCount,
    districtsUsed: geo.districts.length,
    dataRetrievedAt,
  });
  return result;
}

export function validateAll(candidates: readonly CandidateRecord[], geo: StateGeometry) {
  const located: LocatedCandidate[] = [];
  const rejected: RejectedRecord[] = [];
  for (const c of candidates) {
    const v = validateLocation(c, geo);
    if (v.ok) {
      located.push({ ...c, name: c.name!, lon: c.lon!, lat: c.lat!, locationFlags: v.flags });
    } else {
      rejected.push({
        id: c.key,
        name: c.name,
        source: c.source,
        url: c.sourceRef.url,
        reason: v.reason,
        coordinates: c.lon !== null && c.lat !== null ? [c.lon, c.lat] : null,
        detectedState: v.detectedState,
      });
    }
  }
  return { located, rejected };
}

export interface BoundariesOptions {
  paths: PipelinePaths;
  offline: boolean;
  http?: Omit<HttpOptions, 'userAgent'>;
  log?: (message: string) => void;
}

export async function runBoundaries(opts: BoundariesOptions) {
  const log = opts.log ?? (() => {});
  const config = loadConfig(opts.paths);
  const adm1Source = getSource(config, ADM1_SOURCE);
  const adm2Source = getSource(config, ADM2_SOURCE);
  const store = new RawStore(opts.paths.rawBoundariesDir);
  if (!opts.offline) store.reset([adm1Source.id, adm2Source.id]);
  const fetcher = opts.offline ? offlineFetcher(store) : onlineFetcher(store, { ...opts.http, userAgent: config.sources.userAgent, log });

  const adm1 = await fetchBoundary(adm1Source, fetcher);
  const adm2 = await fetchBoundary(adm2Source, fetcher);
  if (!opts.offline) store.save();
  log(`ADM1 ${adm1.collection.features.length} features, ADM2 ${adm2.collection.features.length} features`);
  if (adm1Source.downloadUrl && adm1Source.downloadUrl !== adm1.downloadUrl) {
    log(`note: ADM1 API now points to ${adm1.downloadUrl} (config/sources.json has ${adm1Source.downloadUrl})`);
  }

  const out = buildBoundaryOutputs(adm1, adm2, config.states);
  const dir = opts.paths.boundariesDir;
  writeText(join(dir, 'india-states.geojson'), serializeFeatureCollection({ metadata: out.indiaStates.metadata }, out.indiaStates.features));
  for (const s of out.states) {
    const { state, stateFeature, districts, districtCount } = s.output;
    writeText(join(dir, `${state.slug}-state.geojson`), serializeFeatureCollection({ metadata: { ...s.metadata, state: state.name, stateCode: state.code } }, [stateFeature]));
    writeText(
      join(dir, `${state.slug}-districts.geojson`),
      serializeFeatureCollection({ metadata: { ...s.districtsMetadata, state: state.name, stateCode: state.code, districtCount } }, districts),
    );
    log(`${state.slug}: ${districtCount.actual} districts (expected ${districtCount.expected})${districtCount.ok ? '' : ' MISMATCH'}`);
  }
  return out;
}
