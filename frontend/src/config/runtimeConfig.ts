import { z } from 'zod';

/**
 * Runtime configuration (design decision 10). Sources, highest priority first:
 * 1. `/config.json` written next to index.html at deploy time,
 * 2. `import.meta.env.VITE_*` for local overrides,
 * 3. defaults (local mode: no API key, fallback basemap, no routing).
 * The frontend never reads AWS credentials; the only secret-like value is the restricted Location API key.
 */
export const MAP_STYLES = ['Standard', 'Monochrome', 'Hybrid', 'Satellite'] as const;
export type MapStyleName = (typeof MAP_STYLES)[number];

export interface RuntimeConfig {
  mode: 'local' | 'aws';
  region: string;
  locationApiKey: string | null;
  mapStyle: MapStyleName;
  apiBaseUrl: string | null;
  summariesEnabled: boolean;
}

export const DEFAULT_REGION = 'us-east-1';

const regionSchema = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);
const apiBaseUrlSchema = z.url({ protocol: /^https?$/ });

const FileConfig = z
  .object({
    region: z.string().optional(),
    locationApiKey: z.string().optional(),
    mapStyle: z.string().optional(),
    apiBaseUrl: z.string().optional(),
    summariesEnabled: z.union([z.boolean(), z.string()]).optional(),
  })
  .partial();
type FileConfig = z.infer<typeof FileConfig>;

export interface EnvLike {
  VITE_LOCATION_API_KEY?: string;
  VITE_AWS_REGION?: string;
  VITE_MAP_STYLE?: string;
  VITE_API_BASE_URL?: string;
  VITE_SUMMARIES_ENABLED?: string;
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const toBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  const s = nonEmpty(v);
  if (s === null) return null;
  return s.toLowerCase() === 'true';
};

export function resolveRuntimeConfig(file: FileConfig | null, env: EnvLike): RuntimeConfig {
  const key = nonEmpty(file?.locationApiKey) ?? nonEmpty(env.VITE_LOCATION_API_KEY);
  const regionRaw = nonEmpty(file?.region) ?? nonEmpty(env.VITE_AWS_REGION) ?? DEFAULT_REGION;
  const region = regionSchema.safeParse(regionRaw).success ? regionRaw : DEFAULT_REGION;
  const styleRaw = nonEmpty(file?.mapStyle) ?? nonEmpty(env.VITE_MAP_STYLE) ?? 'Standard';
  const mapStyle = (MAP_STYLES as readonly string[]).includes(styleRaw) ? (styleRaw as MapStyleName) : 'Standard';
  const apiRaw = nonEmpty(file?.apiBaseUrl) ?? nonEmpty(env.VITE_API_BASE_URL);
  const apiBaseUrl = apiRaw && apiBaseUrlSchema.safeParse(apiRaw).success ? apiRaw.replace(/\/+$/, '') : null;
  const summaries = toBool(file?.summariesEnabled) ?? toBool(env.VITE_SUMMARIES_ENABLED) ?? false;
  return {
    mode: key ? 'aws' : 'local',
    region,
    locationApiKey: key,
    mapStyle,
    apiBaseUrl,
    summariesEnabled: summaries && apiBaseUrl !== null,
  };
}

/** Fetches `/config.json`; a 404, HTML fallback page or invalid JSON is ignored. */
export async function loadRuntimeConfig(
  fetchFn: typeof fetch = fetch,
  env: EnvLike = import.meta.env as EnvLike,
): Promise<RuntimeConfig> {
  let file: FileConfig | null = null;
  try {
    const res = await fetchFn('/config.json', { cache: 'no-store' });
    if (res.ok) {
      const parsed = FileConfig.safeParse(await res.json());
      if (parsed.success) file = parsed.data;
    }
  } catch {
    // No config.json (local dev) or not JSON: stay with env/defaults.
  }
  return resolveRuntimeConfig(file, env);
}
