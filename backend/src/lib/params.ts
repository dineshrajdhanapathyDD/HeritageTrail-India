import { z } from 'zod';
import { Category, INDIA_BBOX, SiteId, StateCode } from '@heritagetrail/shared';

/** Handler-side validation (API Gateway only enforces presence). Ranges from plan decision 20. */
const num = (min: number, max: number) => z.coerce.number().refine(Number.isFinite).pipe(z.number().min(min).max(max));
const int = (min: number, max: number) => z.coerce.number().pipe(z.number().int().min(min).max(max));

export const PAGE_TOKEN_REGEX = /^[A-Za-z0-9_-]{1,2048}$/;

export const SitesQuery = z.object({
  state: StateCode,
  category: Category.optional(),
  period: z.enum(['known', 'unknown']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: int(1, 200).default(50),
  nextToken: z.string().regex(PAGE_TOKEN_REGEX).optional(),
});
export type SitesQuery = z.infer<typeof SitesQuery>;

export const NearbyQuery = z.object({
  lat: num(INDIA_BBOX.minLat, INDIA_BBOX.maxLat),
  lon: num(INDIA_BBOX.minLon, INDIA_BBOX.maxLon),
  radiusKm: num(1, 100).default(10),
  limit: int(1, 200).default(50),
});
export type NearbyQuery = z.infer<typeof NearbyQuery>;

export const StatsQuery = z.object({ state: StateCode });

export const SitePath = z.object({ id: SiteId });

/** Names of the offending parameters only; values are never echoed back. */
export function invalidParamNames(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? 'request')))].sort();
}
