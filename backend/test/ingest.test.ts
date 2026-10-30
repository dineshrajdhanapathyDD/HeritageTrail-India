import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { S3Event } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeritageCollection } from '@heritagetrail/shared';
import { batchWrite, buildStats, handler, ingestCollection, MAX_ATTEMPTS, STATE_FILE_KEY, timing } from '../src/handlers/ingest.ts';
import { featureToItem } from '../src/lib/keys.ts';
import { committed, setEnv } from './helpers.ts';
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const put = (n: number) => Array.from({ length: n }, (_, i) => ({ PutRequest: { Item: { pk: `SITE#t-${i}`, sk: 'META' } } }));
function s3Event(key: string): S3Event {
  return { Records: [{ s3: { bucket: { name: 'data-bucket' }, object: { key } } }] } as unknown as S3Event;
}
function body(text: string) {
  return { transformToString: async () => text } as never;
}
let sleep: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setEnv();
  ddbMock.reset();
  s3Mock.reset();
  sleep = vi.spyOn(timing, 'sleep').mockResolvedValue();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('batchWrite', () => {
  it('splits 60 requests into 3 batches of at most 25', async () => {
    ddbMock.on(BatchWriteCommand).resolves({});
    await batchWrite(put(60));
    const sizes = ddbMock.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems!['test-table']!.length);
    expect(sizes).toEqual([25, 25, 10]);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('retries UnprocessedItems with exponential backoff', async () => {
    const reqs = put(5);
    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { 'test-table': reqs.slice(3) } })
      .resolvesOnce({ UnprocessedItems: { 'test-table': reqs.slice(4) } })
      .resolvesOnce({});
    await batchWrite(reqs);
    const calls = ddbMock.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems!['test-table']);
    expect(calls).toEqual([reqs, reqs.slice(3), reqs.slice(4)]);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });
  it(`gives up after ${MAX_ATTEMPTS} attempts`, async () => {
    const reqs = put(2);
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: { 'test-table': reqs } });
    await expect(batchWrite(reqs)).rejects.toThrow('BatchWrite left 2 unprocessed items');
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(MAX_ATTEMPTS);
  });
});
describe('ingestCollection', () => {
  const sub: HeritageCollection = { ...committed, features: committed.features.slice(0, 60) };
  it('writes 60 items in 3 batches, deletes stale items and stores stats', async () => {
    const keep = featureToItem(sub.features[0]!);
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [{ pk: keep.pk, sk: 'META' }, { pk: 'SITE#wd-Q999999999', sk: 'META' }] });
    const result = await ingestCollection(sub);
    expect(result).toEqual({ written: 60, deleted: 1 });
    const batches = ddbMock.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems!['test-table']!);
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10, 1]);
    expect(batches[3]).toEqual([{ DeleteRequest: { Key: { pk: 'SITE#wd-Q999999999', sk: 'META' } } }]);
    const query = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query).toMatchObject({ IndexName: 'GSI1', ExpressionAttributeValues: { ':pk': 'STATE#IN-TN' }, ProjectionExpression: 'pk, sk' });
    const stats = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(stats).toEqual(buildStats(sub));
    expect(stats.total).toBe(60);
    expect(stats.verified + stats.unverified).toBe(60);
  });
  it('builds stats that match the committed collection counts', () => {
    const stats = buildStats(committed);
    expect(stats).toMatchObject({
      pk: 'STATS#IN-TN',
      total: committed.metadata.counts.total,
      verified: committed.metadata.counts.verified,
      unverified: committed.metadata.counts.unverified,
      byCategory: committed.metadata.counts.byCategory,
    });
    expect(Object.values(stats.byDistrict).reduce((a, b) => a + b, 0)).toBe(committed.features.length);
  });
});
describe('handler (S3 ObjectCreated)', () => {
  it('only accepts per-state processed files', () => {
    expect(STATE_FILE_KEY.test('processed/tamil-nadu.geojson')).toBe(true);
    expect(STATE_FILE_KEY.test('processed/boundaries/india-states.geojson')).toBe(false);
    expect(STATE_FILE_KEY.test('processed/tamil-nadu.report.json')).toBe(false);
    expect(STATE_FILE_KEY.test('raw/tamil-nadu/manifest.json')).toBe(false);
  });
  it('skips boundary files without reading S3', async () => {
    await handler(s3Event('processed/boundaries/india-states.geojson'));
    expect(s3Mock.calls()).toHaveLength(0);
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('rejects an invalid file without any DynamoDB write', async () => {
    const invalid = { ...committed, features: [{ ...committed.features[0]!, properties: { ...committed.features[0]!.properties, sources: [] } }] };
    for (const text of [JSON.stringify(invalid), JSON.stringify({ type: 'FeatureCollection', features: [] }), '{not json']) {
      s3Mock.on(GetObjectCommand).resolves({ Body: body(text) });
      await expect(handler(s3Event('processed/tamil-nadu.geojson'))).rejects.toThrow();
    }
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('ingests a valid file named by a URL-encoded key', async () => {
    // The schema requires counts that match the features, so recompute them for the 3-feature subset.
    const features = committed.features.slice(0, 3);
    const verified = features.filter((f) => f.properties.verificationStatus === 'verified').length;
    const byCategory: Record<string, number> = {};
    for (const f of features) byCategory[f.properties.category] = (byCategory[f.properties.category] ?? 0) + 1;
    const counts = { ...committed.metadata.counts, total: 3, verified, unverified: 3 - verified, byCategory };
    const sub = { ...committed, metadata: { ...committed.metadata, counts }, features };
    s3Mock.on(GetObjectCommand).resolves({ Body: body(JSON.stringify(sub)) });
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
    await handler(s3Event('processed/tamil-nadu.geojson'));
    expect(s3Mock.commandCalls(GetObjectCommand)[0]!.args[0].input).toEqual({ Bucket: 'data-bucket', Key: 'processed/tamil-nadu.geojson' });
    expect(ddbMock.commandCalls(BatchWriteCommand)[0]!.args[0].input.RequestItems!['test-table']).toHaveLength(3);
    expect(ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({ pk: 'STATS#IN-TN', total: 3 });
  });
});
