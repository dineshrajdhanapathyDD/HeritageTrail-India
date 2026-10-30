import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, httpRequest, type HttpOptions, type HttpRequest } from './http.ts';

/** One stored response. Request identity is `querySha256`; body integrity is `bodySha256`. */
export interface ManifestEntry {
  source: string;
  name: string;
  url: string;
  method: 'GET' | 'POST';
  /** Request body (SPARQL / Overpass QL form data) kept for provenance; null for GET. */
  requestBody: string | null;
  querySha256: string;
  fetchedAt: string;
  status: number | null;
  bodySha256: string | null;
  error: string | null;
}

export interface Manifest {
  entries: ManifestEntry[];
}

export interface RawFetchRequest extends HttpRequest {
  /** Source id from config/sources.json. */
  source: string;
  /** File stem, `[a-z0-9-]+`. */
  name: string;
}

export type RawResult =
  | { ok: true; body: string; fetchedAt: string }
  | { ok: false; status: number | null; error: string; fetchedAt: string };

export interface RawFetcher {
  readonly offline: boolean;
  get(req: RawFetchRequest): Promise<RawResult>;
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export const querySha256 = (req: HttpRequest): string => sha256(`${req.method} ${req.url}\n${req.body ?? ''}`);

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Raw copies under `<dir>/<source>/<name>.json` plus `<dir>/manifest.json`. */
export class RawStore {
  private manifest: Manifest = { entries: [] };

  constructor(readonly dir: string) {
    const file = join(dir, 'manifest.json');
    if (existsSync(file)) this.manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  }

  get entries(): readonly ManifestEntry[] {
    return this.manifest.entries;
  }

  fileFor(source: string, name: string): string {
    if (!NAME_RE.test(source) || !NAME_RE.test(name)) throw new Error(`Invalid raw file name ${source}/${name}`);
    return join(this.dir, source, `${name}.json`);
  }

  /** Remove stored responses of these sources before an online re-fetch. */
  reset(sources: readonly string[]): void {
    for (const source of sources) rmSync(join(this.dir, source), { recursive: true, force: true });
    this.manifest.entries = this.manifest.entries.filter((e) => !sources.includes(e.source));
  }

  record(req: RawFetchRequest, fetchedAt: string, outcome: { body: string; status: number } | { error: string; status: number | null }): void {
    const base = {
      source: req.source,
      name: req.name,
      url: req.url,
      method: req.method,
      requestBody: req.body ?? null,
      querySha256: querySha256(req),
      fetchedAt,
    };
    let entry: ManifestEntry;
    if ('body' in outcome) {
      const file = this.fileFor(req.source, req.name);
      mkdirSync(join(this.dir, req.source), { recursive: true });
      writeFileSync(file, outcome.body, 'utf8');
      entry = { ...base, status: outcome.status, bodySha256: sha256(outcome.body), error: null };
    } else {
      entry = { ...base, status: outcome.status, bodySha256: null, error: outcome.error };
    }
    this.manifest.entries = this.manifest.entries.filter((e) => !(e.source === req.source && e.name === req.name));
    this.manifest.entries.push(entry);
  }

  /** Read a stored response; fails if the stored request differs from `req` or the body was altered. */
  read(req: RawFetchRequest): RawResult {
    const entry = this.manifest.entries.find((e) => e.source === req.source && e.name === req.name);
    if (!entry) throw new Error(`No raw copy for ${req.source}/${req.name} in ${this.dir}; run without --offline first`);
    if (entry.querySha256 !== querySha256(req)) {
      throw new Error(`Raw copy ${req.source}/${req.name} was fetched with a different request; run without --offline`);
    }
    if (entry.bodySha256 === null) {
      return { ok: false, status: entry.status, error: entry.error ?? 'failed', fetchedAt: entry.fetchedAt };
    }
    const body = readFileSync(this.fileFor(req.source, req.name), 'utf8');
    if (sha256(body) !== entry.bodySha256) throw new Error(`Raw copy ${req.source}/${req.name} does not match its bodySha256`);
    return { ok: true, body, fetchedAt: entry.fetchedAt };
  }

  save(): void {
    mkdirSync(this.dir, { recursive: true });
    const entries = [...this.manifest.entries].sort((a, b) =>
      a.source === b.source ? compareStrings(a.name, b.name) : compareStrings(a.source, b.source),
    );
    writeFileSync(join(this.dir, 'manifest.json'), `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  }
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** OSM tags that can hold personal contact details; dropped before raw copies are stored. */
export const CONTACT_TAG_RE = /^(phone|mobile|fax|email|contact:.+)$/;

/**
 * Removes contact tags (phone, mobile, fax, email, contact:*) from an Overpass JSON response so no
 * personal data is kept in data/raw. Other content is unchanged; non-JSON bodies are returned as is.
 */
export function scrubContactTags(body: string): string {
  let doc: { elements?: Array<{ tags?: Record<string, string> }> };
  try {
    doc = JSON.parse(body);
  } catch {
    return body;
  }
  if (!Array.isArray(doc.elements)) return body;
  let changed = false;
  for (const el of doc.elements) {
    for (const key of Object.keys(el.tags ?? {})) {
      if (CONTACT_TAG_RE.test(key)) {
        delete el.tags![key];
        changed = true;
      }
    }
  }
  return changed ? `${JSON.stringify(doc, null, 2)}\n` : body;
}

export function onlineFetcher(store: RawStore, http: HttpOptions): RawFetcher {
  return {
    offline: false,
    async get(req) {
      http.log?.(`  fetch ${req.source}/${req.name} ${req.method} ${new URL(req.url).host}`);
      const fetchedAt = new Date().toISOString();
      try {
        const res = await httpRequest(req, http);
        const body = req.source === 'osm-overpass' ? scrubContactTags(res.body) : res.body;
        store.record(req, fetchedAt, { body, status: res.status });
        store.save();
        return { ok: true, body, fetchedAt };
      } catch (err) {
        const status = err instanceof HttpError ? err.status : null;
        const error = err instanceof Error ? err.message : String(err);
        store.record(req, fetchedAt, { error, status });
        store.save();
        return { ok: false, status, error, fetchedAt };
      }
    },
  };
}

export function offlineFetcher(store: RawStore): RawFetcher {
  return { offline: true, get: async (req) => store.read(req) };
}
