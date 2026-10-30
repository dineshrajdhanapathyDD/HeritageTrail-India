// Test helpers that read the committed pipeline output (data/processed), so tests run on real records.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeritageCollection, type HeritageFeature } from '@heritagetrail/shared';
import type { DistrictFeature } from '../data/loadSites.ts';

export const PROCESSED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/processed');

export function readProcessed(rel: string): string {
  return readFileSync(resolve(PROCESSED_DIR, rel), 'utf8');
}

let cached: HeritageFeature[] | null = null;
export function committedFeatures(): HeritageFeature[] {
  cached ??= HeritageCollection.parse(JSON.parse(readProcessed('tamil-nadu.geojson'))).features;
  return cached;
}

export function committedDistricts(): DistrictFeature[] {
  return JSON.parse(readProcessed('boundaries/tamil-nadu-districts.geojson')).features as DistrictFeature[];
}

export function featureById(id: string): HeritageFeature {
  const f = committedFeatures().find((x) => x.properties.id === id);
  if (!f) throw new Error(`fixture ${id} not in committed data`);
  return f;
}

/** fetch stub serving /data/* from data/processed (and 404 for anything else, e.g. /config.json). */
export function processedFetch(extra: Record<string, unknown> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url in extra) return new Response(JSON.stringify(extra[url]), { status: 200 });
    if (url.startsWith('/data/')) {
      try {
        return new Response(readProcessed(url.slice('/data/'.length)), { status: 200 });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
