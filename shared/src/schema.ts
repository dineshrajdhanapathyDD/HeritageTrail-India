import { z } from 'zod';
import { SITE_ID_REGEX } from './ids.ts';
import { INDIA_BBOX } from './geo.ts';

export const CATEGORIES = ['temple', 'fort', 'monument', 'museum', 'archaeological-site', 'other'] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const VERIFICATION_STATUSES = ['verified', 'unverified', 'rejected'] as const;
export const VerificationStatus = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const UnescoStatus = z.enum(['inscribed', 'component', 'tentative']).nullable();
export type UnescoStatus = z.infer<typeof UnescoStatus>;

export const SiteId = z.string().regex(SITE_ID_REGEX, 'invalid site id');
export const StateCode = z.string().regex(/^IN-[A-Z]{2}$/, 'invalid ISO 3166-2:IN code');

export const SIMPLE_FLAGS = [
  'missing-district',
  'missing-period',
  'missing-description',
  'missing-image',
  'district-derived',
  'district-mismatch',
  'coordinate-conflict',
  'boundary-tolerance',
] as const;
export const POSSIBLE_DUPLICATE_PREFIX = 'possible-duplicate:';

const possibleDuplicateFlag = z
  .string()
  .regex(new RegExp(`^${POSSIBLE_DUPLICATE_PREFIX}${SITE_ID_REGEX.source.slice(1, -1)}$`), 'invalid flag');

export const Flag = z.union([z.enum(SIMPLE_FLAGS), possibleDuplicateFlag]);
export type Flag = z.infer<typeof Flag>;

const isoDateTime = z.iso.datetime({ offset: true });

export const SourceRef = z.object({
  /** Source id from config/sources.json, e.g. `wikidata`, `osm-overpass`. */
  name: z.string().min(1),
  /** Identifier inside that source, e.g. `Q123` or `node/1669711997`. */
  id: z.string().min(1),
  url: z.url(),
  license: z.string().min(1),
  licenseUrl: z.url(),
  retrievedAt: isoDateTime,
});
export type SourceRef = z.infer<typeof SourceRef>;

export const ImageInfo = z.object({
  url: z.url(),
  thumbUrl: z.url().nullable(),
  filePageUrl: z.url(),
  license: z.string().min(1),
  /** Null only for public-domain files that carry no licence URL. */
  licenseUrl: z.url().nullable(),
  artist: z.string().min(1),
  credit: z.string().nullable(),
});
export type ImageInfo = z.infer<typeof ImageInfo>;

export const Period = z.object({
  label: z.string().min(1),
  year: z.number().int().nullable(),
  source: z.string().min(1),
});
export type Period = z.infer<typeof Period>;

export const Description = z.object({
  text: z.string().min(1),
  source: z.string().min(1),
  license: z.string().min(1),
});
export type Description = z.infer<typeof Description>;

export const HeritageSiteProperties = z.object({
  id: SiteId,
  name: z.string().min(1),
  state: z.string().min(1),
  stateCode: StateCode,
  district: z.string().min(1).nullable(),
  category: Category,
  unesco: UnescoStatus,
  unescoWhsId: z.string().min(1).nullable(),
  unescoUrl: z.url().nullable(),
  designations: z.array(z.string().min(1)),
  asiMonumentId: z.string().min(1).nullable(),
  period: Period.nullable(),
  description: Description.nullable(),
  image: ImageInfo.nullable(),
  sources: z.array(SourceRef).min(1),
  license: z.string().min(1),
  verificationStatus: VerificationStatus,
  flags: z.array(Flag),
});
export type HeritageSiteProperties = z.infer<typeof HeritageSiteProperties>;

export const LonLat = z.tuple([
  z.number().min(INDIA_BBOX.minLon).max(INDIA_BBOX.maxLon),
  z.number().min(INDIA_BBOX.minLat).max(INDIA_BBOX.maxLat),
]);

export const HeritageFeature = z.object({
  type: z.literal('Feature'),
  id: SiteId.optional(),
  geometry: z.object({
    type: z.literal('Point'),
    /** GeoJSON order: [longitude, latitude]. */
    coordinates: LonLat,
  }),
  properties: HeritageSiteProperties,
});
export type HeritageFeature = z.infer<typeof HeritageFeature>;

export const DatasetSourceSummary = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  license: z.string().min(1),
  licenseUrl: z.url(),
  recordCount: z.number().int().nonnegative(),
});
export type DatasetSourceSummary = z.infer<typeof DatasetSourceSummary>;

export const CollectionCounts = z
  .object({
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    byCategory: z.partialRecord(Category, z.number().int().nonnegative()),
  })
  .refine((c) => c.total === c.verified + c.unverified, {
    message: 'total must equal verified + unverified (rejected records are not in the collection)',
  });

export const CollectionMetadata = z.object({
  state: z.string().min(1),
  stateCode: StateCode,
  /** Latest fetchedAt in the raw manifest; never a wall-clock build time. */
  dataRetrievedAt: isoDateTime,
  sources: z.array(DatasetSourceSummary).min(1),
  attribution: z.array(z.string().min(1)).min(1),
  databaseLicense: z.string().min(1),
  counts: CollectionCounts,
});
export type CollectionMetadata = z.infer<typeof CollectionMetadata>;

export const HeritageCollection = z
  .object({
    type: z.literal('FeatureCollection'),
    metadata: CollectionMetadata,
    features: z.array(HeritageFeature),
  })
  .superRefine((fc, ctx) => {
    const seen = new Set<string>();
    fc.features.forEach((f, i) => {
      if (f.properties.verificationStatus === 'rejected') {
        ctx.addIssue({ code: 'custom', path: ['features', i], message: 'rejected records must not be published' });
      }
      if (seen.has(f.properties.id)) {
        ctx.addIssue({ code: 'custom', path: ['features', i], message: `duplicate id ${f.properties.id}` });
      }
      seen.add(f.properties.id);
    });
    if (fc.metadata.counts.total !== fc.features.length) {
      ctx.addIssue({ code: 'custom', path: ['metadata', 'counts', 'total'], message: 'count does not match features' });
    }
  });
export type HeritageCollection = z.infer<typeof HeritageCollection>;
