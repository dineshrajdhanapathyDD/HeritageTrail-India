import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function requestOrigin(event: Pick<APIGatewayProxyEvent, 'headers'>): string | undefined {
  const headers = event.headers ?? {};
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === 'origin') return v ?? undefined;
  return undefined;
}

/** JSON response; CORS headers only when the request origin is on the allow-list. */
export function json(status: number, body: unknown, origin?: string): APIGatewayProxyResult {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': status === 200 ? 'public, max-age=60' : 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  };
  if (origin && allowedOrigins().includes(origin)) headers['access-control-allow-origin'] = origin;
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

/** Generic error body: a stable code and a fixed message; no stack traces or echoed input. */
export function errorResponse(status: number, error: string, message: string, origin?: string): APIGatewayProxyResult {
  return json(status, { error, message }, origin);
}

type Level = 'info' | 'warn' | 'error';

/** Structured log line. Callers pass only routing metadata and counts, never request bodies or keys. */
export function log(level: Level, msg: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError';
}
