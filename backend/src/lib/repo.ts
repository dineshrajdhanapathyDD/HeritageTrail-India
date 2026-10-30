import { GetCommand, PutCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import ngeohash from 'ngeohash';
import { z } from 'zod';
import { haversineKm, normalizeName, type HeritageFeature } from '@heritagetrail/shared';
import { ddb, GSI1, GSI2, tableName } from './ddb.ts';
import { GEOHASH_PRECISION, geoPk, itemToFeature, siteKey, statePk, statsKey, summaryKey } from './keys.ts';
import type { NearbyQuery, SitesQuery } from './params.ts';

export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';
}

export async function getSite(id: string): Promise<HeritageFeature | null> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: siteKey(id) }));
  return res.Item ? itemToFeature(res.Item) : null;
}

const Gsi1Cursor = z
  .object({ pk: z.string(), sk: z.literal('META'), gsi1pk: z.string(), gsi1sk: z.string() })
  .strict();

export function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/** Decodes a pagination token and checks it is a GSI1 cursor for the requested state. */
export function decodeToken(token: string, stateCode: string): Record<string, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidTokenError('malformed token');
  }
  const parsed = Gsi1Cursor.safeParse(raw);
  if (!parsed.success || parsed.data.gsi1pk !== statePk(stateCode) || !parsed.data.pk.startsWith('SITE#')) {
    throw new InvalidTokenError('token does not match query');
  }
  return parsed.data;
}

export async function querySitesByState(q: SitesQuery): Promise<{ items: HeritageFeature[]; nextToken?: string }> {
  const names: Record<string, string> = { '#pk': 'gsi1pk' };
  const values: Record<string, unknown> = { ':pk': statePk(q.state) };
  let keyCondition = '#pk = :pk';
  if (q.category) {
    names['#sk'] = 'gsi1sk';
    values[':cat'] = `${q.category}#`;
    keyCondition += ' AND begins_with(#sk, :cat)';
  }
  const filters: string[] = [];
  if (q.q) {
    names['#nameNorm'] = 'nameNorm';
    values[':q'] = normalizeName(q.q);
    filters.push('contains(#nameNorm, :q)');
  }
  if (q.period) {
    names['#period'] = 'period';
    values[':ptype'] = q.period === 'known' ? 'M' : 'NULL';
    filters.push('attribute_type(#period, :ptype)');
  }
  const input: QueryCommandInput = {
    TableName: tableName(),
    IndexName: GSI1,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    Limit: q.limit,
    ...(filters.length ? { FilterExpression: filters.join(' AND ') } : {}),
    ...(q.nextToken ? { ExclusiveStartKey: decodeToken(q.nextToken, q.state) } : {}),
  };
  const res = await ddb.send(new QueryCommand(input));
  return {
    items: (res.Items ?? []).map(itemToFeature),
    ...(res.LastEvaluatedKey ? { nextToken: encodeToken(res.LastEvaluatedKey) } : {}),
  };
}

/** Centre geohash-3 cell plus its 8 neighbours (about 156 km cells; covers radius <= 100 km), then haversine. */
export async function nearbySites(q: NearbyQuery): Promise<Array<HeritageFeature & { distanceKm: number }>> {
  const centre = ngeohash.encode(q.lat, q.lon, GEOHASH_PRECISION);
  const cells = [centre, ...ngeohash.neighbors(centre)];
  const pages = await Promise.all(cells.map((cell) => queryAll(GSI2, 'gsi2pk', geoPk(cell))));
  const origin: [number, number] = [q.lon, q.lat];
  return pages
    .flat()
    .map(itemToFeature)
    .map((f) => ({ ...f, distanceKm: Math.round(haversineKm(origin, f.geometry.coordinates) * 1000) / 1000 }))
    .filter((f) => f.distanceKm <= q.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.properties.id.localeCompare(b.properties.id))
    .slice(0, q.limit);
}

export async function queryAll(
  indexName: string,
  pkAttr: string,
  pkValue: string,
  projection?: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        IndexName: indexName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': pkAttr },
        ExpressionAttributeValues: { ':pk': pkValue },
        ...(projection ? { ProjectionExpression: projection } : {}),
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    out.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return out;
}

export interface StateStats {
  stateCode: string;
  state: string;
  total: number;
  verified: number;
  unverified: number;
  byCategory: Record<string, number>;
  byDistrict: Record<string, number>;
  dataRetrievedAt: string;
}

export async function getStats(stateCode: string): Promise<StateStats | null> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: statsKey(stateCode) }));
  if (!res.Item) return null;
  const { pk: _pk, sk: _sk, ...stats } = res.Item;
  return stats as StateStats;
}

export interface CachedSummary {
  summary: string;
  modelId: string;
  generatedFrom: string[];
  sources: Array<{ name: string; url: string; license: string }>;
}

export async function getSummary(id: string, modelId: string): Promise<CachedSummary | null> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: summaryKey(id, modelId) }));
  if (!res.Item) return null;
  const { summary, generatedFrom, sources } = res.Item as CachedSummary;
  return { summary, modelId, generatedFrom, sources };
}

export async function putSummary(id: string, value: CachedSummary): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...summaryKey(id, value.modelId), ...value, createdAt: new Date().toISOString() },
    }),
  );
}
