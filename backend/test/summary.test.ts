import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, GetCommand, PutCommand, type GetCommandInput } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFacts, handler, SYSTEM_PROMPT } from '../src/handlers/summary.ts';
import { featureToItem } from '../src/lib/keys.ts';
import { apiEvent, committed, setEnv } from './helpers.ts';
const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);
const MODEL = 'us.amazon.nova-2-lite-v1:0';
const withText = committed.features.find((f) => f.properties.description)!;
const withoutText = committed.features.find((f) => !f.properties.description)!;
const post = (id: string) => apiEvent('/sites/{id}/summary', { method: 'POST', path: { id } });
/** GetCommand mock: META returns the site item, SUMMARY# returns the cached summary (if any). */
function table(site: object | undefined, cached?: object) {
  ddbMock.on(GetCommand).callsFake((input: GetCommandInput) => ({
    Item: String(input.Key?.sk) === 'META' ? site : cached,
  }));
  ddbMock.on(PutCommand).resolves({});
}
beforeEach(() => {
  setEnv();
  ddbMock.reset();
  bedrockMock.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('POST /sites/{id}/summary', () => {
  it('has committed fixtures with and without a stored description', () => {
    expect(withText).toBeDefined();
    expect(withoutText).toBeDefined();
  });
  it('returns 400 for a malformed id', async () => {
    expect((await handler(post('not an id'))).statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });
  it('returns 404 when the site does not exist', async () => {
    table(undefined);
    const res = await handler(post('wd-Q1'));
    expect(res.statusCode).toBe(404);
    expect(bedrockMock.calls()).toHaveLength(0);
  });
  it('returns 422 without a stored description and does not call Bedrock', async () => {
    table(featureToItem(withoutText));
    const res = await handler(post(withoutText.properties.id));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toBe('insufficient_source_text');
    expect(bedrockMock.calls()).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
  it('serves a cached summary without calling Bedrock', async () => {
    const cached = { summary: 'Cached text.', generatedFrom: ['name', 'sources'], sources: [] };
    table(featureToItem(withText), { pk: `SITE#${withText.properties.id}`, sk: `SUMMARY#${MODEL}`, ...cached });
    const res = await handler(post(withText.properties.id));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ...cached, modelId: MODEL, aiGenerated: true, cached: true });
    expect(bedrockMock.calls()).toHaveLength(0);
    const keys = ddbMock.commandCalls(GetCommand).map((c) => c.args[0].input.Key);
    expect(keys).toContainEqual({ pk: `SITE#${withText.properties.id}`, sk: `SUMMARY#${MODEL}` });
  });
  it('calls Converse with grounded facts only and stores the result in the cache', async () => {
    table(featureToItem(withText));
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: '  A short grounded summary.  ' }] } },
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    } as never);
    const res = await handler(post(withText.properties.id));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out).toMatchObject({ summary: 'A short grounded summary.', modelId: MODEL, aiGenerated: true, cached: false });
    expect(out.sources).toEqual(withText.properties.sources.map((s) => ({ name: s.name, url: s.url, license: s.license })));
    const input = bedrockMock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.modelId).toBe(MODEL);
    expect(input.system).toEqual([{ text: SYSTEM_PROMPT }]);
    const prompt = input.messages![0]!.content![0]!.text!;
    expect(prompt).toContain(buildFacts(withText.properties).text);
    expect(prompt).toContain(`description: ${withText.properties.description!.text}`);
    const stored = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(stored).toMatchObject({ pk: `SITE#${withText.properties.id}`, sk: `SUMMARY#${MODEL}`, summary: 'A short grounded summary.', modelId: MODEL });
    expect(stored.generatedFrom).toContain('description');
  });
  it('returns a generic 500 when Bedrock fails, without storing anything', async () => {
    table(featureToItem(withText));
    bedrockMock.on(ConverseCommand).rejects(new Error('AccessDeniedException: detail'));
    const res = await handler(post(withText.properties.id));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('detail');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
