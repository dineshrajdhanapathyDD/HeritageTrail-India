import { RemovalPolicy } from 'aws-cdk-lib';

export type EnvName = 'dev' | 'prod';

export interface EnvironmentConfig {
  envName: EnvName;
  /** Region for every resource except Bedrock (Amazon Location V2 checked by scripts/check-region.ts). */
  region: string;
  bedrockRegion: string;
  bedrockModelId: string;
  /** Regions of the foundation models the inference profile routes to (read with bedrock GetInferenceProfile). */
  bedrockModelRegions: string[];
  enableSummaries: boolean;
  /** Origins allowed besides the CloudFront domain (CORS and API key referers). */
  extraAllowedOrigins: string[];
  throttle: { rateLimit: number; burstLimit: number };
  removalPolicy: RemovalPolicy;
  autoDeleteObjects: boolean;
  mapStyle: 'Standard' | 'Monochrome' | 'Hybrid' | 'Satellite';
}

const shared = {
  // User choice: deploy in us-east-1. Location V2 maps/places/routes were verified there read-only.
  region: 'us-east-1',
  bedrockRegion: 'us-east-1',
  bedrockModelId: 'us.amazon.nova-2-lite-v1:0',
  bedrockModelRegions: ['us-east-1', 'us-east-2', 'us-west-2'],
  enableSummaries: true,
  throttle: { rateLimit: 20, burstLimit: 40 },
  mapStyle: 'Standard',
} as const;

export const ENVIRONMENTS: Record<EnvName, EnvironmentConfig> = {
  dev: {
    ...shared,
    bedrockModelRegions: [...shared.bedrockModelRegions],
    envName: 'dev',
    extraAllowedOrigins: ['http://localhost:5173', 'http://localhost:4173'],
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  },
  prod: {
    ...shared,
    bedrockModelRegions: [...shared.bedrockModelRegions],
    envName: 'prod',
    extraAllowedOrigins: [],
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  },
};

type ContextGetter = (key: string) => unknown;

const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** Resolves `-c env=dev|prod` plus overrides `-c enableSummaries=false`, `-c bedrockModelId=...`, `-c region=...`. */
export function resolveEnvironment(ctx: ContextGetter): EnvironmentConfig {
  const envName = String(ctx('env') ?? 'dev');
  if (envName !== 'dev' && envName !== 'prod') throw new Error(`Unknown env "${envName}" (expected dev or prod)`);
  const cfg: EnvironmentConfig = { ...ENVIRONMENTS[envName] };

  const enable = ctx('enableSummaries');
  if (enable !== undefined) cfg.enableSummaries = enable === true || String(enable).toLowerCase() === 'true';

  const model = ctx('bedrockModelId');
  if (model !== undefined) {
    if (!/^[a-z0-9.:-]+$/.test(String(model))) throw new Error('Invalid bedrockModelId');
    cfg.bedrockModelId = String(model);
  }
  for (const key of ['region', 'bedrockRegion'] as const) {
    const value = ctx(key);
    if (value === undefined) continue;
    if (!REGION_RE.test(String(value))) throw new Error(`Invalid ${key}`);
    cfg[key] = String(value);
  }
  return cfg;
}
