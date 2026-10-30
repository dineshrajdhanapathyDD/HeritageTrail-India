import { z } from 'zod';
import { SITE_ID_REGEX } from '@heritagetrail/shared';

const SummaryResponse = z.object({
  summary: z.string().min(1),
  aiGenerated: z.literal(true),
  modelId: z.string().min(1),
  sources: z.array(z.object({ url: z.string(), license: z.string().optional(), name: z.string().optional() }).passthrough()),
});
export type SummaryResponse = z.infer<typeof SummaryResponse>;

export type SummaryOutcome =
  | { ok: true; value: SummaryResponse }
  | { ok: false; reason: 'insufficient_source_text' | 'unavailable' };

/** POST <apiBaseUrl>/sites/{id}/summary (ARCHITECTURE.md section 8). */
export async function fetchSummary(apiBaseUrl: string, siteId: string, fetchFn: typeof fetch = fetch): Promise<SummaryOutcome> {
  if (!SITE_ID_REGEX.test(siteId)) return { ok: false, reason: 'unavailable' };
  try {
    const res = await fetchFn(`${apiBaseUrl}/sites/${encodeURIComponent(siteId)}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 422) return { ok: false, reason: 'insufficient_source_text' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const parsed = SummaryResponse.safeParse(await res.json());
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
