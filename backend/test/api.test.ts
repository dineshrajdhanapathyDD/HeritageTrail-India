import { DynamoDBDocumentClient, GetCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { haversineKm } from '@heritagetrail/shared';
import { handler as api } from '../src/handlers/api.ts';
import { encodeToken } from '../src/lib/repo.ts';
import { featureToItem } from '../src/lib/keys.ts';
import { ALLOWED_ORIGIN, apiEvent, committed, setEnv } from './helpers.ts';
const ddbMock = mockClient(DynamoDBDocumentClient);
const items = committed.features.map(featureToItem);
const body = (res: { body: string }) => JSON.parse(res.body);
beforeEach(() => {
  setEnv();
  ddbMock.reset();
});
describe('GET /sites', () => {
  it('queries GSI1 for the state and returns features', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: items.slice(0, 3) });
    const res = await api(apiEvent('/sites', { query: { state: 'IN-TN', category: 'temple', q: 'Siva', limit: '3' } }));
    expect(res.statusCode).toBe(200);
    const out = body(res);
    expect(out.items).toHaveLength(3);
    expect(out.items[0].properties.id).toBe(committed.features[0]!.properties.id);
    expect(out.nextToken).toBeUndefined();
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input).toMatchObject({
      TableName: 'test-table',
      IndexName: 'GSI1',
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :cat)',
      ExpressionAttributeValues: { ':pk': 'STATE#IN-TN', ':cat': 'temple#', ':q': 'siva' },
      FilterExpression: 'contains(#nameNorm, :q)',
      Limit: 3,
    });
  });
  it('round-trips the pagination token into ExclusiveStartKey', async () => {
    const lastKey = { pk: items[0]!.pk, sk: 'META', gsi1pk: 'STATE#IN-TN', gsi1sk: items[0]!.gsi1sk };
    ddbMock.on(QueryCommand).resolvesOnce({ Items: items.slice(0, 2), LastEvaluatedKey: lastKey }).resolvesOnce({ Items: items.slice(2, 4) });
    const first = body(await api(apiEvent('/sites', { query: { state: 'IN-TN', limit: '2' } })));
    expect(first.nextToken).toBe(encodeToken(lastKey));
    const second = await api(apiEvent('/sites', { query: { state: 'IN-TN', limit: '2', nextToken: first.nextToken } }));
    expect(second.statusCode).toBe(200);
    expect(body(second).nextToken).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });
  it('rejects bad tokens with 400 and no DynamoDB call', async () => {
    const otherState = encodeToken({ pk: 'SITE#wd-Q1', sk: 'META', gsi1pk: 'STATE#IN-KL', gsi1sk: 'x' });
    const notJson = Buffer.from('not json').toString('base64url');
    for (const nextToken of ['!!bad!!', notJson, otherState]) {
      const res = await api(apiEvent('/sites', { query: { state: 'IN-TN', nextToken } }));
      expect(res.statusCode).toBe(400);
      expect(body(res)).toEqual({ error: 'invalid_request', message: 'Invalid parameter(s): nextToken' });
    }
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
  it('requires a valid state and limit', async () => {
    expect((await api(apiEvent('/sites'))).statusCode).toBe(400);
    expect((await api(apiEvent('/sites', { query: { state: 'Tamil Nadu' } }))).statusCode).toBe(400);
    expect((await api(apiEvent('/sites', { query: { state: 'IN-TN', limit: '500' } }))).statusCode).toBe(400);
    expect((await api(apiEvent('/sites', { query: { state: 'IN-TN', category: 'castle' } }))).statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});
describe('GET /sites/{id}', () => {
  const f = committed.features[0]!;
  it('returns 200 with the feature', async () => {
    ddbMock.on(GetCommand).resolves({ Item: featureToItem(f) });
    const res = await api(apiEvent('/sites/{id}', { path: { id: f.properties.id } }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ ...f, id: f.properties.id });
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ pk: `SITE#${f.properties.id}`, sk: 'META' });
  });
  it('returns 404 for an unknown id', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await api(apiEvent('/sites/{id}', { path: { id: 'wd-Q1' } }));
    expect(res.statusCode).toBe(404);
    expect(body(res).error).toBe('not_found');
  });
  it('returns 400 for a malformed id without calling DynamoDB', async () => {
    for (const id of ['bad id', 'wd-', '../etc', 'osm-relation-x']) {
      expect((await api(apiEvent('/sites/{id}', { path: { id } }))).statusCode).toBe(400);
    }
    expect(ddbMock.calls()).toHaveLength(0);
  });
});
describe('GET /sites/nearby', () => {
  it.each([
    ['lat 40', { lat: '40', lon: '79' }],
    ['radius 0', { lat: '10.78', lon: '79.13', radiusKm: '0' }],
    ['radius 101', { lat: '10.78', lon: '79.13', radiusKm: '101' }],
    ['non-numeric lon', { lat: '10.78', lon: 'abc' }],
  ])('rejects %s with 400', async (_name, query) => {
    const res = await api(apiEvent('/sites/nearby', { query }));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('queries the 9 geohash cells and filters by haversine distance', async () => {
    ddbMock.on(QueryCommand).callsFake((input: QueryCommandInput) => {
      const pk = input.ExpressionAttributeValues?.[':pk'];
      return { Items: items.filter((i) => i.gsi2pk === pk) };
    });
    // Centre: the committed coordinates of Prahadisvarar Temple, Thanjavur (wd-Q916943); 50 km radius.
    const centre: [number, number] = [79.1325, 10.78306];
    const res = await api(apiEvent('/sites/nearby', { query: { lat: '10.78306', lon: '79.1325', radiusKm: '50', limit: '200' } }));
    expect(res.statusCode).toBe(200);
    const out = body(res).items as Array<{ distanceKm: number; properties: { id: string } }>;
    const calls = ddbMock.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(calls).toHaveLength(9);
    expect(new Set(calls.map((c) => c.ExpressionAttributeValues?.[':pk'])).size).toBe(9);
    expect(calls.every((c) => c.IndexName === 'GSI2')).toBe(true);
    const expected = committed.features
      .map((f) => ({ id: f.properties.id, d: haversineKm(centre, f.geometry.coordinates) }))
      .filter((x) => x.d <= 50)
      .map((x) => x.id)
      .sort();
    expect(out.map((o) => o.properties.id).sort()).toEqual(expected);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.distanceKm <= 50)).toBe(true);
    expect(out.map((o) => o.distanceKm)).toEqual([...out.map((o) => o.distanceKm)].sort((a, b) => a - b));
    // The radius crosses geohash-3 cell borders: results come from more than one cell.
    const cellOf = new Map(items.map((i) => [i.id, i.gsi2pk]));
    expect(new Set(out.map((o) => cellOf.get(o.properties.id))).size).toBeGreaterThan(1);
    // Items outside the radius were returned by DynamoDB but filtered out.
    const fetched = items.filter((i) => calls.some((c) => c.ExpressionAttributeValues?.[':pk'] === i.gsi2pk)).length;
    expect(fetched).toBeGreaterThan(out.length);
  });
});
describe('GET /stats', () => {
  it('returns the stats item without key attributes', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: 'STATS#IN-TN', sk: 'META', stateCode: 'IN-TN', state: 'Tamil Nadu', total: 2, verified: 1, unverified: 1, byCategory: {}, byDistrict: {}, dataRetrievedAt: 'x' },
    });
    const res = await api(apiEvent('/stats', { query: { state: 'IN-TN' } }));
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ stateCode: 'IN-TN', state: 'Tamil Nadu', total: 2, verified: 1, unverified: 1, byCategory: {}, byDistrict: {}, dataRetrievedAt: 'x' });
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ pk: 'STATS#IN-TN', sk: 'META' });
  });
  it('returns 404 when no stats exist and 400 without a state', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect((await api(apiEvent('/stats', { query: { state: 'IN-KL' } }))).statusCode).toBe(404);
    expect((await api(apiEvent('/stats'))).statusCode).toBe(400);
  });
});
describe('CORS and errors', () => {
  it('sets access-control-allow-origin only for an allowed origin', async () => {
    ddbMock.on(GetCommand).resolves({});
    const allowed = await api(apiEvent('/stats', { query: { state: 'IN-TN' } }));
    expect(allowed.headers?.['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    const cf = await api(apiEvent('/stats', { query: { state: 'IN-TN' }, origin: 'https://d111111abcdef8.cloudfront.net' }));
    expect(cf.headers?.['access-control-allow-origin']).toBe('https://d111111abcdef8.cloudfront.net');
    const evil = await api(apiEvent('/stats', { query: { state: 'IN-TN' }, origin: 'https://evil.example' }));
    expect(evil.headers?.['access-control-allow-origin']).toBeUndefined();
    const none = await api(apiEvent('/stats', { query: { state: 'IN-TN' }, origin: null }));
    expect(none.headers?.['access-control-allow-origin']).toBeUndefined();
    // Error responses also carry CORS for allowed origins (the frontend needs to read them).
    const bad = await api(apiEvent('/stats'));
    expect(bad.headers?.['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
  it('returns a generic 500 when DynamoDB fails, and 404 for unknown routes', async () => {
    ddbMock.on(GetCommand).rejects(new Error('boom: secret detail'));
    const res = await api(apiEvent('/stats', { query: { state: 'IN-TN' } }));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
    expect((await api(apiEvent('/admin'))).statusCode).toBe(404);
    expect((await api(apiEvent('/sites', { method: 'DELETE', query: { state: 'IN-TN' } }))).statusCode).toBe(404);
  });
});
