import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { HeritageCollection } from '@heritagetrail/shared';
export const ALLOWED_ORIGIN = 'http://localhost:5173';
/** Committed pipeline output, so handler tests run on real records. */
export const committed = HeritageCollection.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../data/processed/tamil-nadu.geojson', import.meta.url)), 'utf8')),
);
export function apiEvent(
  resource: string,
  opts: {
    method?: string;
    query?: Record<string, string> | null;
    path?: Record<string, string> | null;
    origin?: string | null;
  } = {},
): APIGatewayProxyEvent {
  const origin = opts.origin === undefined ? ALLOWED_ORIGIN : opts.origin;
  return {
    httpMethod: opts.method ?? 'GET',
    resource,
    queryStringParameters: opts.query ?? null,
    pathParameters: opts.path ?? null,
    headers: origin ? { Origin: origin } : {},
  } as unknown as APIGatewayProxyEvent;
}
export function setEnv(): void {
  process.env.TABLE_NAME = 'test-table';
  process.env.ALLOWED_ORIGINS = `${ALLOWED_ORIGIN},https://d111111abcdef8.cloudfront.net`;
  process.env.BEDROCK_MODEL_ID = 'us.amazon.nova-2-lite-v1:0';
  process.env.BEDROCK_REGION = 'us-east-1';
}
