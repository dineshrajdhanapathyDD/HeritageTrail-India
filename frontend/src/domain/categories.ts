import type { Category } from '@heritagetrail/shared';

export const CATEGORY_LABELS: Record<Category, string> = {
  temple: 'Temple',
  fort: 'Fort',
  monument: 'Monument',
  museum: 'Museum',
  'archaeological-site': 'Archaeological site',
  other: 'Other heritage',
};

export const UNESCO_LABELS = {
  inscribed: 'UNESCO World Heritage Site',
  component: 'Part of a UNESCO World Heritage Site',
  tentative: 'UNESCO Tentative List',
} as const;

export const VERIFICATION_LABELS = {
  verified: 'Verified',
  unverified: 'Unverified',
  rejected: 'Rejected',
} as const;

export const VERIFICATION_EXPLANATIONS = {
  verified:
    'Inside the claimed state boundary (or within 2 km of its edge), with name and coordinates, and either an ASI Monument ID or UNESCO ID, or two sources agreeing within 500 m.',
  unverified: 'Inside the claimed state, but from a single source without an official identifier.',
  rejected: 'Outside India or the claimed state, or without coordinates. Rejected records are not published.',
} as const;

/** Plain-language explanation of each data-quality flag set by the pipeline. */
export const FLAG_EXPLANATIONS: Record<string, string> = {
  'missing-district': 'No district could be determined.',
  'missing-period': 'No construction date or period in the sources.',
  'missing-description': 'No description in the sources.',
  'missing-image': 'No openly licensed image found.',
  'district-derived': 'District derived from the geoBoundaries district polygon, not stated by a source.',
  'district-mismatch': 'The source district differs from the district polygon containing the point; the source value is shown.',
  'coordinate-conflict': 'Sources disagree on the location by more than 500 m; Wikidata coordinates are shown.',
  'boundary-tolerance': 'The point lies just outside the state polygon (within 2 km), usually on the coast.',
  'possible-duplicate': 'Another record with a different name lies within 50 m in the same category.',
};

export function flagExplanation(flag: string): string {
  if (flag.startsWith('possible-duplicate:')) return FLAG_EXPLANATIONS['possible-duplicate'] ?? flag;
  return FLAG_EXPLANATIONS[flag] ?? flag;
}

export const SOURCE_LABELS: Record<string, string> = {
  wikidata: 'Wikidata',
  'osm-overpass': 'OpenStreetMap',
  commons: 'Wikimedia Commons',
};
