import type { ImageInfo, SourceConfig } from '@heritagetrail/shared';
import type { RawFetchRequest, RawFetcher } from '../rawStore.ts';
import { compareStrings } from '../rawStore.ts';
import { fetchJson, type RawPayload } from './types.ts';

export const COMMONS_BATCH_SIZE = 50;

interface ExtValue {
  value?: string;
}
interface CommonsPage {
  title: string;
  missing?: string;
  invalid?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Partial<Record<'LicenseShortName' | 'LicenseUrl' | 'Artist' | 'Credit', ExtValue>>;
  }[];
}
interface CommonsResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: Record<string, CommonsPage>;
  };
  continue?: Record<string, string>;
}

export type ImageResolution = { ok: true; image: ImageInfo } | { ok: false; reason: string };

function batchUrl(source: SourceConfig, titles: readonly string[], cont?: Record<string, string>): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
    format: 'json',
    titles: titles.map((t) => `File:${t}`).join('|'),
    ...cont,
  });
  return `${source.endpoint}?${params.toString()}`;
}

/** Requests for file names in sorted batches of at most 50 titles. */
export function buildCommonsBatches(source: SourceConfig, files: Iterable<string>): { titles: string[]; request: RawFetchRequest }[] {
  const unique = [...new Set(files)].sort(compareStrings);
  const out: { titles: string[]; request: RawFetchRequest }[] = [];
  for (let i = 0; i < unique.length; i += COMMONS_BATCH_SIZE) {
    const titles = unique.slice(i, i + COMMONS_BATCH_SIZE);
    const n = String(out.length + 1).padStart(3, '0');
    out.push({ titles, request: { source: source.id, name: `batch-${n}`, url: batchUrl(source, titles), method: 'GET' } });
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Remove HTML tags and decode entities from Commons extmetadata values. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drop Wikimedia `utm_*` tracking parameters from upload URLs. */
export function cleanUrl(url: string): string {
  const u = new URL(url.startsWith('//') ? `https:${url}` : url);
  for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key);
  return u.toString();
}

const isPublicDomain = (licence: string): boolean => /public domain|^pd\b|^pd-|^cc0/i.test(licence);

/** Keep an image only when licence name, licence URL (or public domain) and author all resolve. */
export function resolvePage(page: CommonsPage | undefined): ImageResolution {
  if (!page || page.missing !== undefined || page.invalid !== undefined) return { ok: false, reason: 'file-not-found' };
  const info = page.imageinfo?.[0];
  if (!info?.url) return { ok: false, reason: 'no-imageinfo' };
  const meta = info.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value ?? '');
  if (!license) return { ok: false, reason: 'licence-unresolved' };
  const licenseUrlRaw = stripHtml(meta.LicenseUrl?.value ?? '');
  if (!licenseUrlRaw && !isPublicDomain(license)) return { ok: false, reason: 'licence-url-unresolved' };
  const artist = stripHtml(meta.Artist?.value ?? '');
  if (!artist || /^unknown\b/i.test(artist)) return { ok: false, reason: 'author-unresolved' };
  const credit = stripHtml(meta.Credit?.value ?? '');
  const title = page.title.replace(/^File:/, '');
  return {
    ok: true,
    image: {
      url: cleanUrl(info.url),
      thumbUrl: info.thumburl ? cleanUrl(info.thumburl) : null,
      filePageUrl: info.descriptionurl
        ? cleanUrl(info.descriptionurl)
        : `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title.replace(/ /g, '_'))}`,
      license,
      licenseUrl: licenseUrlRaw ? cleanUrl(licenseUrlRaw) : null,
      artist,
      credit: credit || null,
    },
  };
}

/** Map requested file names to resolved images or drop reasons, using one or more batch responses. */
export function resolveImages(titles: readonly string[], payloads: readonly RawPayload[]): Map<string, ImageResolution> {
  const normalized = new Map<string, string>();
  const pages = new Map<string, CommonsPage>();
  for (const p of payloads) {
    const q = (p.body as CommonsResponse).query;
    for (const n of q?.normalized ?? []) normalized.set(n.from, n.to);
    for (const page of Object.values(q?.pages ?? {})) {
      const existing = pages.get(page.title);
      // Continuation responses may repeat a page; keep the one carrying imageinfo.
      if (!existing || (!existing.imageinfo && page.imageinfo)) pages.set(page.title, page);
    }
  }
  const out = new Map<string, ImageResolution>();
  for (const t of titles) {
    const requested = `File:${t}`;
    out.set(t, resolvePage(pages.get(normalized.get(requested) ?? requested)));
  }
  return out;
}

export interface CommonsResult {
  images: Map<string, ImageResolution>;
  failures: { name: string; status: number | null; error: string }[];
}

export async function fetchCommonsImages(source: SourceConfig, files: Iterable<string>, ctx: RawFetcher): Promise<CommonsResult> {
  const images = new Map<string, ImageResolution>();
  const failures: CommonsResult['failures'] = [];
  for (const batch of buildCommonsBatches(source, files)) {
    const payloads: RawPayload[] = [];
    let request = batch.request;
    try {
      for (let page = 1; page <= 20; page++) {
        const payload = await fetchJson(ctx, request);
        payloads.push(payload);
        const cont = (payload.body as CommonsResponse).continue;
        if (!cont) break;
        request = { ...batch.request, name: `${batch.request.name}-${page + 1}`, url: batchUrl(source, batch.titles, cont) };
      }
      for (const [t, r] of resolveImages(batch.titles, payloads)) images.set(t, r);
    } catch (err) {
      const e = err as { status?: number | null; message?: string };
      failures.push({ name: request.name, status: e.status ?? null, error: e.message ?? String(err) });
      for (const t of batch.titles) images.set(t, { ok: false, reason: 'commons-request-failed' });
    }
  }
  return { images, failures };
}
