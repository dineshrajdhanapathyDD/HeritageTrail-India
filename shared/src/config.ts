import { z } from 'zod';
import { Category, StateCode } from './schema.ts';

/** Matches an OSM tag. `value: "*"` matches any value of the key. */
export const OsmTagMatch = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});
export type OsmTagMatch = z.infer<typeof OsmTagMatch>;

export const CategoryRule = z.object({
  category: Category,
  /** Case-insensitive substrings matched against English labels of Wikidata P31 values. */
  wikidataLabelKeywords: z.array(z.string().min(1)),
  osmTags: z.array(OsmTagMatch),
});
export type CategoryRule = z.infer<typeof CategoryRule>;

/** Rules are evaluated in order; the first match wins. */
export const CategoriesConfig = z.object({
  rules: z.array(CategoryRule).min(1),
  fallback: Category,
});
export type CategoriesConfig = z.infer<typeof CategoriesConfig>;

export const OverpassTagFilter = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  /** Extra keys that must also be present (any value), e.g. `historic` for places of worship. */
  requireKeys: z.array(z.string().min(1)).default([]),
});
export type OverpassTagFilter = z.infer<typeof OverpassTagFilter>;

export const SourceKind = z.enum(['sites', 'images', 'boundaries']);

export const SourceConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  publisher: z.string().min(1),
  kind: SourceKind,
  enabled: z.boolean(),
  endpoint: z.url(),
  /** Page in docs/DATASETS.md evidence that states the licence or terms. */
  termsUrl: z.url(),
  license: z.string().min(1),
  licenseUrl: z.url(),
  attribution: z.string().min(1),
  /** Short provenance caveat carried into reports, e.g. an unverified upstream licence. */
  provenanceNote: z.string().min(1).nullable(),
  /** Direct file download, when it differs from the metadata endpoint. */
  downloadUrl: z.url().nullable().default(null),
  overpass: z
    .object({
      tagFilters: z.array(OverpassTagFilter).min(1),
      excludeTags: z.array(OsmTagMatch),
      timeoutSeconds: z.number().int().positive(),
    })
    .optional(),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

export const SourcesConfig = z
  .object({
    userAgent: z.string().min(1),
    sources: z.array(SourceConfig).min(1),
  })
  .refine((c) => new Set(c.sources.map((s) => s.id)).size === c.sources.length, {
    message: 'source ids must be unique',
  });
export type SourcesConfig = z.infer<typeof SourcesConfig>;

export const StateConfig = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  code: StateCode,
  name: z.string().min(1),
  wikidataQid: z.string().regex(/^Q\d+$/),
  /** Value of the OSM `ISO3166-2` tag on the state boundary relation. */
  osmIso: StateCode,
  /** Value of `shapeISO` in geoBoundaries ADM1. */
  adm1ShapeISO: StateCode,
  expectedDistrictCount: z.number().int().positive(),
  asiCentrallyProtected: z
    .object({
      count: z.number().int().nonnegative(),
      source: z.url(),
      asOf: z.iso.date(),
    })
    .nullable(),
});
export type StateConfig = z.infer<typeof StateConfig>;
