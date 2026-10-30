import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeritageCollection } from '@heritagetrail/shared';
import { handler as api } from '../src/handlers/api.ts';
import { ingestCollection } from '../src/handlers/ingest.ts';
import { featureToItem, itemToFeature } from '../src/lib/keys.ts';

const ddbMock = mockClient(DynamoDBDocumentClient);
const committed = HeritageCollection.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../data/processed/tamil-nadu.geojson', import.meta.url)), 'utf8')),
);

function event(resource: string, query: Record<string, string> | null = null, path: Record<string, string> | null = null) {
  return {
    httpMethod: 'GET',
    resource,
    queryStringParameters: query,
    pathParameters: path,
    headers: { Origin: 'http://localhost:5173' },
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  process.env.TABLE_NAME = 'test-table';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  ddbMock.reset();
});
afterEach(() => ddbMock.reset());

describe('backend smoke', () => {
  it('round-trips a committed feature through the DynamoDB item shape', () => {
    const f = committed.features[0]!;
    const item = featureToItem(f);
    expect(item.pk).toBe(`SITE#${f.properties.id}`);
    expect(item.gsi1pk).toBe('STATE#IN-TN');
    expect(item.gsi2pk).toMatch(/^GH3#[0-9a-z]{3}$/);
    expect(itemToFeature(item as unknown as Record<string, unknown>)).toEqual({ ...f, id: f.properties.id });
  });

  it('GET /sites/{id} returns the site, 404 when missing, with CORS for an allowed origin', async () => {
    const f = committed.features[0]!;
    ddbMock.on(GetCommand).resolvesOnce({ Item: featureToItem(f) }).resolvesOnce({});
    const ok = await api(event('/sites/{id}', null, { id: f.properties.id }));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers?.['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(JSON.parse(ok.body).properties.id).toBe(f.properties.id);
    const missing = await api(event('/sites/{id}', null, { id: 'wd-Q1' }));
    expect(missing.statusCode).toBe(404);
  });

  it('GET /sites/nearby rejects out-of-range latitude without echoing the value', async () => {
    const res = await api(event('/sites/nearby', { lat: '99.123', lon: '80' }));
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('99.123');
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('ingest writes every committed feature in chunks of 25 and the stats item', async () => {
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
    const result = await ingestCollection(committed);
    expect(result).toEqual({ written: committed.features.length, deleted: 0 });
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(Math.ceil(committed.features.length / 25));
    const stats = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(stats).toMatchObject({ pk: 'STATS#IN-TN', total: committed.metadata.counts.total, verified: committed.metadata.counts.verified });
  });
});
