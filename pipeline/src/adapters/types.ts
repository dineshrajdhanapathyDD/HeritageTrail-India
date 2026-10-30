import type {
  Category,
  Description,
  Period,
  SourceRef,
  StateConfig,
  UnescoStatus,
} from '@heritagetrail/shared';
import type { RawFetcher } from '../rawStore.ts';

/** A parsed raw response handed from `fetch` to `normalize`. */
export interface RawPayload {
  name: string;
  body: unknown;
  fetchedAt: string;
}

/** One site as reported by a single source, before validation and dedupe. */
export interface CandidateRecord {
  /** Site id this record would get as primary: `wd-Q…` or `osm-<type>-<id>`. */
  key: string;
  /** Source id from config/sources.json. */
  source: string;
  name: string | null;
  lon: number | null;
  lat: number | null;
  /** Own QID for Wikidata records; the `wikidata` tag for OSM elements. */
  wikidataQid: string | null;
  category: Category;
  /** District name claimed by the source (Wikidata P131 district), suffix " district" removed. */
  districtClaim: string | null;
  designations: string[];
  asiIds: string[];
  whsIds: string[];
  unesco: UnescoStatus;
  period: Period | null;
  description: Description | null;
  /** Wikimedia Commons file name without the `File:` prefix. */
  imageFile: string | null;
  sourceRef: SourceRef;
}

/** Raised when a source could not be fetched; the run continues and the report records it. */
export class SourceFetchError extends Error {
  constructor(
    readonly source: string,
    readonly request: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

/** A site source. Adding a source = one adapter implementing this + an entry in config/sources.json. */
export interface SourceAdapter {
  readonly id: string;
  fetch(state: StateConfig, ctx: RawFetcher): Promise<RawPayload[]>;
  normalize(raw: RawPayload[], state: StateConfig): CandidateRecord[];
}

/** Fetch a request through the fetcher and parse JSON, raising SourceFetchError on failure. */
export async function fetchJson(
  ctx: RawFetcher,
  req: Parameters<RawFetcher['get']>[0],
  check?: (body: unknown) => string | null,
): Promise<RawPayload> {
  const res = await ctx.get(req);
  if (!res.ok) throw new SourceFetchError(req.source, req.name, res.status, res.error);
  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    throw new SourceFetchError(req.source, req.name, null, 'response is not JSON');
  }
  const problem = check?.(body) ?? null;
  if (problem) throw new SourceFetchError(req.source, req.name, null, problem);
  return { name: req.name, body, fetchedAt: res.fetchedAt };
}
