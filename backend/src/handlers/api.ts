import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { z } from 'zod';
import { errorName, errorResponse, json, log, requestOrigin } from '../lib/http.ts';
import { invalidParamNames, NearbyQuery, SitePath, SitesQuery, StatsQuery } from '../lib/params.ts';
import { getSite, getStats, InvalidTokenError, nearbySites, querySitesByState } from '../lib/repo.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; response: APIGatewayProxyResult };

function parse<S extends z.ZodType>(schema: S, input: unknown, origin?: string): Parsed<z.infer<S>> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return { ok: true, value: r.data };
  const names = invalidParamNames(r.error);
  return { ok: false, response: errorResponse(400, 'invalid_request', `Invalid parameter(s): ${names.join(', ')}`, origin) };
}

/** REST API router: GET /sites, GET /sites/{id}, GET /sites/nearby, GET /stats (ARCHITECTURE.md section 8). */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = requestOrigin(event);
  const route = `${event.httpMethod} ${event.resource}`;
  try {
    switch (route) {
      case 'GET /sites': {
        const p = parse(SitesQuery, event.queryStringParameters, origin);
        if (!p.ok) return p.response;
        return json(200, await querySitesByState(p.value), origin);
      }
      case 'GET /sites/nearby': {
        const p = parse(NearbyQuery, event.queryStringParameters, origin);
        if (!p.ok) return p.response;
        return json(200, { items: await nearbySites(p.value) }, origin);
      }
      case 'GET /sites/{id}': {
        const p = parse(SitePath, event.pathParameters, origin);
        if (!p.ok) return p.response;
        const site = await getSite(p.value.id);
        return site ? json(200, site, origin) : errorResponse(404, 'not_found', 'Site not found', origin);
      }
      case 'GET /stats': {
        const p = parse(StatsQuery, event.queryStringParameters, origin);
        if (!p.ok) return p.response;
        const stats = await getStats(p.value.state);
        return stats ? json(200, stats, origin) : errorResponse(404, 'not_found', 'No data for this state', origin);
      }
      default:
        return errorResponse(404, 'not_found', 'Route not found', origin);
    }
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return errorResponse(400, 'invalid_request', 'Invalid parameter(s): nextToken', origin);
    }
    log('error', 'api request failed', { route, error: errorName(err) });
    return errorResponse(500, 'internal_error', 'Internal error', origin);
  }
}
