export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpOptions {
  userAgent: string;
  /** Total attempts including the first one. */
  maxAttempts?: number;
  /** Wait before the second attempt; doubled for each further attempt. */
  backoffMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch with an identifying User-Agent and retry on 429/502/503/504 and network errors
 * (Overpass and Wikidata usage guidance: identify the app, back off 30 s).
 */
export async function httpRequest(req: HttpRequest, opts: HttpOptions): Promise<HttpResponse> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 200_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError = 'no attempt made';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(req.url, {
        method: req.method,
        headers: { 'User-Agent': opts.userAgent, ...req.headers },
        body: req.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      if (res.ok) return { status: res.status, body };
      lastStatus = res.status;
      lastError = `HTTP ${res.status}`;
      if (!RETRYABLE_STATUSES.has(res.status)) {
        throw new HttpError(`${lastError} from ${new URL(req.url).host}`, res.status, attempt);
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastStatus = null;
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    if (attempt < maxAttempts) {
      const wait = backoffMs * 2 ** (attempt - 1);
      opts.log?.(`  ${lastError} from ${new URL(req.url).host}; retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
    }
  }
  throw new HttpError(`${lastError} from ${new URL(req.url).host} after ${maxAttempts} attempts`, lastStatus, maxAttempts);
}
