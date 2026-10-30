import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIES,
  haversineKm,
  HeritageCollection,
  POSSIBLE_DUPLICATE_PREFIX,
  SIMPLE_FLAGS,
  type Category,
  type DatasetSourceSummary,
  type Flag,
  type HeritageFeature,
  type HeritageSiteProperties,
  type SourceConfig,
  type SourceRef,
  type StateConfig,
} from '@heritagetrail/shared';
import type { ImageResolution } from './adapters/commons.ts';
import { unescoUrlFor } from './adapters/wikidata.ts';
import type { PipelineConfig } from './config.ts';
import { CONFLICT_KM, mergedCategory, sourcesAgree, type DedupeStats, type MergedRecord } from './dedupe.ts';
import { prettyJson, serializeFeatureCollection, writeText } from './geojson.ts';
import { recordLicense } from './normalize.ts';
import type { PipelinePaths } from './paths.ts';
import { compareStrings } from './rawStore.ts';
import { assignDistrict, verificationStatus, type DistrictAssignment, type RejectReason, type StateGeometry } from './validate.ts';

export function sortFlags(flags: Iterable<Flag>): Flag[] {
  const rank = (f: Flag) => {
    const i = (SIMPLE_FLAGS as readonly string[]).indexOf(f);
    return i === -1 ? SIMPLE_FLAGS.length : i;
  };
  return [...new Set(flags)].sort((a, b) => rank(a) - rank(b) || compareStrings(a, b));
}

const unionSorted = (lists: string[][]): string[] => [...new Set(lists.flat())].sort(compareStrings);

export interface BuiltFeature {
  feature: HeritageFeature;
  district: DistrictAssignment;
  /** Every ASI Monument ID of the merged record (the feature keeps only the first). */
  asiIds: string[];
  /** Merged members more than 500 m from the published (primary) coordinates. */
  conflicts: { source: string; ref: string; coordinates: [number, number]; km: number }[];
}

/** Turn a deduplicated record into a published feature (district, flags, verification). */
export function buildFeature(r: MergedRecord, geo: StateGeometry, images: ReadonlyMap<string, ImageResolution>): BuiltFeature {
  const all = [r.primary, ...r.members];
  const { lon, lat } = r.primary;
  const district = assignDistrict(geo, lon, lat, r.primary.districtClaim ?? r.members.find((m) => m.districtClaim)?.districtClaim ?? null);
  const asiIds = [...new Set(all.flatMap((c) => c.asiIds))].sort(
    (a, b) => Number(b.startsWith('N-')) - Number(a.startsWith('N-')) || compareStrings(a, b),
  );
  const whsIds = unionSorted(all.map((c) => c.whsIds));
  const period = r.primary.period ?? r.members.find((m) => m.period)?.period ?? null;
  const description = r.primary.description ?? null;
  const imageFile = r.primary.imageFile ?? r.members.find((m) => m.imageFile)?.imageFile ?? null;
  const resolved = imageFile ? images.get(imageFile) : undefined;
  const image = resolved?.ok ? resolved.image : null;
  const sources: SourceRef[] = all
    .map((c) => c.sourceRef)
    .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id));

  const flags: Flag[] = [...r.flags, ...district.flags];
  flags.push(...r.primary.locationFlags);
  if (!period) flags.push('missing-period');
  if (!description) flags.push('missing-description');
  if (!image) flags.push('missing-image');

  const unescoWhsId = whsIds[0] ?? null;
  const properties: HeritageSiteProperties = {
    id: r.primary.key,
    name: r.primary.name,
    state: geo.state.name,
    stateCode: geo.state.code,
    district: district.district,
    category: mergedCategory(r),
    unesco: r.primary.unesco ?? r.members.find((m) => m.unesco)?.unesco ?? null,
    unescoWhsId,
    unescoUrl: unescoWhsId ? unescoUrlFor(unescoWhsId) : null,
    designations: unionSorted(all.map((c) => c.designations)),
    asiMonumentId: asiIds[0] ?? null,
    period,
    description,
    image,
    sources,
    license: recordLicense(sources),
    verificationStatus: verificationStatus({ hasAsiId: asiIds.length > 0, hasWhsId: whsIds.length > 0, sourcesAgree: sourcesAgree(r) }),
    flags: sortFlags(flags),
  };
  return {
    feature: { type: 'Feature', id: properties.id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties },
    district,
    asiIds,
    conflicts: r.members
      .map((m) => ({ source: m.source, ref: m.sourceRef.id, coordinates: [m.lon, m.lat] as [number, number], km: haversineKm([lon, lat], [m.lon, m.lat]) }))
      .filter((c) => c.km > CONFLICT_KM)
      .map((c) => ({ ...c, km: Math.round(c.km * 10) / 10 })),
  };
}

export interface RejectedRecord {
  id: string;
  name: string | null;
  source: string;
  url: string;
  reason: RejectReason;
  coordinates: [number, number] | null;
  detectedState: string | null;
}

export interface SourceFailure {
  source: string;
  request: string;
  status: number | null;
  error: string;
}

export interface ImageStats {
  requested: number;
  kept: number;
  dropped: { file: string; reason: string }[];
}

export interface BuildInput {
  state: StateConfig;
  built: BuiltFeature[];
  rejected: RejectedRecord[];
  candidateCounts: Record<string, number>;
  dedupe: DedupeStats;
  images: ImageStats;
  failures: SourceFailure[];
  usedSources: SourceConfig[];
  districtCount: { expected: number; actual: number; ok: boolean };
  districtsUsed: number;
  dataRetrievedAt: string;
}

const countBy = <T extends string>(items: readonly T[]): Record<T, number> => {
  const out = {} as Record<T, number>;
  for (const k of [...items].sort(compareStrings)) out[k] = (out[k] ?? 0) + 1;
  return out;
};

function byCategory(features: readonly HeritageFeature[]): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const c of CATEGORIES) {
    const n = features.filter((f) => f.properties.category === c).length;
    if (n > 0) out[c] = n;
  }
  return out;
}

function datasetSummary(s: SourceConfig, features: readonly HeritageFeature[], districtsUsed: number): DatasetSourceSummary {
  let recordCount: number;
  if (s.kind === 'sites') recordCount = features.filter((f) => f.properties.sources.some((r) => r.name === s.id)).length;
  else if (s.kind === 'images') recordCount = features.filter((f) => f.properties.image).length;
  else recordCount = s.id.endsWith('adm2') ? districtsUsed : 1;
  return { id: s.id, name: s.name, url: s.endpoint, license: s.license, licenseUrl: s.licenseUrl, recordCount };
}

export function buildCollection(input: BuildInput): HeritageCollection {
  const features = input.built.map((b) => b.feature).sort((a, b) => compareStrings(a.properties.id, b.properties.id));
  const verified = features.filter((f) => f.properties.verificationStatus === 'verified').length;
  const usesOsm = features.some((f) => f.properties.license === 'ODbL-1.0');
  const attribution = input.usedSources.map((s) => s.attribution);
  attribution.push(
    usesOsm
      ? `HeritageTrail India ${input.state.name} dataset is made available under the Open Database License (ODbL 1.0): https://opendatacommons.org/licenses/odbl/1-0/. Images are linked, not included, and keep their own per-file licences.`
      : `HeritageTrail India ${input.state.name} dataset: Wikidata content under CC0 1.0. Images are linked, not included, and keep their own per-file licences.`,
  );
  const collection: HeritageCollection = {
    type: 'FeatureCollection',
    metadata: {
      state: input.state.name,
      stateCode: input.state.code,
      dataRetrievedAt: input.dataRetrievedAt,
      sources: input.usedSources.map((s) => datasetSummary(s, features, input.districtsUsed)),
      attribution,
      databaseLicense: usesOsm ? 'ODbL-1.0' : 'CC0-1.0',
      counts: {
        total: features.length,
        verified,
        unverified: features.length - verified,
        rejected: input.rejected.length,
        byCategory: byCategory(features),
      },
    },
    features,
  };
  return HeritageCollection.parse(collection);
}

export function buildReport(input: BuildInput, collection: HeritageCollection) {
  const features = collection.features;
  const flagNames = features.flatMap((f) =>
    f.properties.flags.map((fl) => (fl.startsWith(POSSIBLE_DUPLICATE_PREFIX) ? 'possible-duplicate' : fl)),
  );
  const asi = input.state.asiCentrallyProtected;
  const centralPrefix = `N-${input.state.code.slice(3)}-`;
  const centralIds = new Set(input.built.flatMap((b) => b.asiIds).filter((id) => id.startsWith(centralPrefix)));
  const districtMismatches = input.built
    .filter((b) => b.district.flags.includes('district-mismatch'))
    .map((b) => ({ id: b.feature.properties.id, name: b.feature.properties.name, claimed: b.district.claimed, adm2: b.district.adm2 }))
    .sort((a, b) => compareStrings(a.id, b.id));
  const mismatchPairs = countBy(districtMismatches.map((m) => `${m.claimed} (claimed) vs ${m.adm2} (ADM2)`));
  return {
    state: input.state.name,
    stateCode: input.state.code,
    dataRetrievedAt: input.dataRetrievedAt,
    counts: {
      candidates: input.candidateCounts,
      published: features.length,
      verified: collection.metadata.counts.verified,
      unverified: collection.metadata.counts.unverified,
      rejected: input.rejected.length,
    },
    byCategory: collection.metadata.counts.byCategory,
    byUnesco: countBy(features.map((f) => f.properties.unesco ?? 'none')),
    flags: countBy(flagNames),
    dedupe: input.dedupe,
    images: input.images,
    districts: {
      ...input.districtCount,
      withSites: new Set(features.map((f) => f.properties.district).filter(Boolean)).size,
      mismatchPairs,
      note: 'On district-mismatch the source (Wikidata P131) district is kept. geoBoundaries ADM2 names Kancheepuram and Chengalputtu appear swapped (checked against OSM admin_level=5 boundaries on 2026-10-30).',
    },
    asiCoverage: asi
      ? {
          asiPublishedCount: asi.count,
          asiSource: asi.source,
          asiAsOf: asi.asOf,
          distinctCentralAsiIds: centralIds.size,
          missing: Math.max(0, asi.count - centralIds.size),
          note: `Distinct ${centralPrefix}* ASI Monument IDs (Wikidata P1371) among published records, compared with the ASI published count. ASI data itself is not ingested.`,
        }
      : null,
    sourceFailures: input.failures,
    rejected: [...input.rejected].sort((a, b) => compareStrings(a.id, b.id)),
    coordinateConflicts: input.built
      .filter((b) => b.conflicts.length > 0)
      .map((b) => ({
        id: b.feature.properties.id,
        name: b.feature.properties.name,
        published: b.feature.geometry.coordinates,
        others: b.conflicts,
      }))
      .sort((a, b) => compareStrings(a.id, b.id)),
    districtMismatches,
  };
}

export interface IndexEntry {
  slug: string;
  code: string;
  name: string;
  file: string;
  featureCount: number;
  verifiedCount: number;
  stateBoundaryFile: string;
  districtsFile: string;
}

/** `data/processed/index.json`: every configured state with a processed file. */
export function buildIndex(paths: PipelinePaths, config: PipelineConfig): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const s of config.states) {
    const file = `${s.slug}.geojson`;
    const full = join(paths.processedDir, file);
    if (!existsSync(full)) continue;
    const fc = JSON.parse(readFileSync(full, 'utf8')) as HeritageCollection;
    out.push({
      slug: s.slug,
      code: s.code,
      name: s.name,
      file,
      featureCount: fc.metadata.counts.total,
      verifiedCount: fc.metadata.counts.verified,
      stateBoundaryFile: `boundaries/${s.slug}-state.geojson`,
      districtsFile: `boundaries/${s.slug}-districts.geojson`,
    });
  }
  return out.sort((a, b) => compareStrings(a.slug, b.slug));
}

export function writeStateOutputs(paths: PipelinePaths, config: PipelineConfig, input: BuildInput): { collection: HeritageCollection; report: ReturnType<typeof buildReport> } {
  const collection = buildCollection(input);
  const report = buildReport(input, collection);
  const { features, type: _type, ...header } = collection;
  writeText(join(paths.processedDir, `${input.state.slug}.geojson`), serializeFeatureCollection(header, features));
  writeText(join(paths.processedDir, `${input.state.slug}.report.json`), prettyJson(report));
  writeText(join(paths.processedDir, 'index.json'), prettyJson(buildIndex(paths, config)));
  return { collection, report };
}
