/** Site IDs: `wd-<QID>` for Wikidata-primary records, `osm-<type>-<id>` for OSM-primary records. */
export const SITE_ID_REGEX = /^(wd-Q\d+|osm-(node|way|relation)-\d+)$/;

export type OsmElementType = 'node' | 'way' | 'relation';

/** Accepts `Q123`, `wd:Q123` or a full entity URL such as `http://www.wikidata.org/entity/Q123`. */
export function wikidataId(qidOrUri: string): string {
  const match = /(Q\d+)$/.exec(qidOrUri.trim());
  if (!match) throw new Error(`Not a Wikidata QID: ${qidOrUri}`);
  return `wd-${match[1]}`;
}

export function osmId(type: OsmElementType, id: number | string): string {
  const idText = String(id);
  if (!/^\d+$/.test(idText)) throw new Error(`Not an OSM element id: ${idText}`);
  return `osm-${type}-${idText}`;
}

export function isSiteId(value: string): boolean {
  return SITE_ID_REGEX.test(value);
}
