import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BatchWriteCommand, PutCommand, type BatchWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import type { S3Event } from 'aws-lambda';
import { HeritageCollection } from '@heritagetrail/shared';
import { ddb, GSI1, tableName } from '../lib/ddb.ts';
import { errorName, log } from '../lib/http.ts';
import { featureToItem, statePk, statsKey, type SiteItem } from '../lib/keys.ts';
import { queryAll } from '../lib/repo.ts';

const s3 = new S3Client({});

/** Only per-state files, e.g. `processed/tamil-nadu.geojson`; boundaries and reports are skipped. */
export const STATE_FILE_KEY = /^processed\/[a-z0-9]+(?:-[a-z0-9]+)*\.geojson$/;

export const BATCH_SIZE = 25;
export const MAX_ATTEMPTS = 5;

export const timing = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];

/** BatchWrite in chunks of 25, retrying UnprocessedItems with exponential backoff (max 5 attempts). */
export async function batchWrite(requests: WriteRequest[]): Promise<void> {
  const table = tableName();
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    let pending: WriteRequest[] = requests.slice(i, i + BATCH_SIZE);
    for (let attempt = 1; pending.length > 0; attempt++) {
      if (attempt > MAX_ATTEMPTS) throw new Error(`BatchWrite left ${pending.length} unprocessed items`);
      if (attempt > 1) await timing.sleep(100 * 2 ** (attempt - 2));
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
      pending = res.UnprocessedItems?.[table] ?? [];
    }
  }
}

export function buildStats(collection: HeritageCollection) {
  const byCategory: Record<string, number> = {};
  const byDistrict: Record<string, number> = {};
  let verified = 0;
  for (const f of collection.features) {
    const p = f.properties;
    if (p.verificationStatus === 'verified') verified++;
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    const district = p.district ?? 'unknown';
    byDistrict[district] = (byDistrict[district] ?? 0) + 1;
  }
  const total = collection.features.length;
  return {
    ...statsKey(collection.metadata.stateCode),
    stateCode: collection.metadata.stateCode,
    state: collection.metadata.state,
    total,
    verified,
    unverified: total - verified,
    byCategory,
    byDistrict,
    dataRetrievedAt: collection.metadata.dataRetrievedAt,
  };
}

export async function ingestCollection(collection: HeritageCollection): Promise<{ written: number; deleted: number }> {
  const items: SiteItem[] = collection.features.map(featureToItem);
  await batchWrite(items.map((Item) => ({ PutRequest: { Item } })));

  const keep = new Set(items.map((i) => i.pk));
  const existing = await queryAll(GSI1, 'gsi1pk', statePk(collection.metadata.stateCode), 'pk, sk');
  const stale = existing.filter((i) => !keep.has(String(i.pk)));
  await batchWrite(stale.map((i) => ({ DeleteRequest: { Key: { pk: i.pk, sk: i.sk } } })));

  await ddb.send(new PutCommand({ TableName: tableName(), Item: buildStats(collection) }));
  return { written: items.length, deleted: stale.length };
}

/** S3 ObjectCreated on processed/*.geojson: validate with the shared schema, then sync DynamoDB. */
export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    if (!STATE_FILE_KEY.test(key)) {
      log('info', 'ingest skipped non-state object', { key });
      continue;
    }
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const text = await obj.Body?.transformToString('utf-8');
      if (!text) throw new Error('empty object');
      const parsed = HeritageCollection.safeParse(JSON.parse(text));
      if (!parsed.success) {
        log('error', 'ingest schema validation failed', { key, issues: parsed.error.issues.length });
        throw new Error(`Schema validation failed for ${key}`);
      }
      const result = await ingestCollection(parsed.data);
      log('info', 'ingest complete', { key, stateCode: parsed.data.metadata.stateCode, ...result });
    } catch (err) {
      log('error', 'ingest failed', { key, error: errorName(err) });
      throw err;
    }
  }
}
