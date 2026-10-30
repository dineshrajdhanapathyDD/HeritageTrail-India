import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { HeritageSiteProperties } from '@heritagetrail/shared';
import { errorName, errorResponse, json, log, requestOrigin } from '../lib/http.ts';
import { SitePath } from '../lib/params.ts';
import { getSite, getSummary, putSummary, type CachedSummary } from '../lib/repo.ts';

let client: BedrockRuntimeClient | undefined;
function bedrock(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION });
  return client;
}

export const SYSTEM_PROMPT = [
  'You write short summaries of Indian heritage sites for a map application.',
  'Use ONLY the facts provided by the user message. Do not add dates, rulers, dynasties, architects, names,',
  'measurements or events that are not in the facts. If a detail is unknown, say that it is not recorded in the',
  'sources. Write 2 to 4 plain sentences in English. Do not use headings, lists or markdown.',
].join(' ');

/** Stored fields used as grounding, in a fixed order. Returns the facts text and the field names used. */
export function buildFacts(p: HeritageSiteProperties): { text: string; fields: string[] } {
  const lines: Array<[string, string | null | undefined]> = [
    ['name', p.name],
    ['description', p.description?.text],
    ['category', p.category],
    ['designations', p.designations.length ? p.designations.join('; ') : null],
    ['period', p.period?.label],
    ['district', p.district],
    ['state', p.state],
    ['unesco', p.unesco],
  ];
  const used = lines.filter((l): l is [string, string] => Boolean(l[1]));
  const sourceLine = p.sources.map((s) => `${s.name} (${s.url})`).join('; ');
  return {
    text: [...used.map(([k, v]) => `${k}: ${v}`), `sources: ${sourceLine}`].join('\n'),
    fields: [...used.map(([k]) => k), 'sources'],
  };
}

/** POST /sites/{id}/summary: grounded Amazon Nova summary, cached per site and model. */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = requestOrigin(event);
  const modelId = process.env.BEDROCK_MODEL_ID;
  try {
    const path = SitePath.safeParse(event.pathParameters ?? {});
    if (!path.success) return errorResponse(400, 'invalid_request', 'Invalid parameter(s): id', origin);
    if (!modelId) throw new Error('BEDROCK_MODEL_ID is not configured');
    const id = path.data.id;

    const site = await getSite(id);
    if (!site) return errorResponse(404, 'not_found', 'Site not found', origin);

    const cached = await getSummary(id, modelId);
    if (cached) return json(200, { ...cached, aiGenerated: true, cached: true }, origin);

    const p = site.properties;
    if (!p.description) {
      return errorResponse(422, 'insufficient_source_text', 'This site has no stored description to summarise', origin);
    }

    const facts = buildFacts(p);
    const res = await bedrock().send(
      new ConverseCommand({
        modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: `Facts:\n${facts.text}\n\nWrite the summary.` }] }],
        inferenceConfig: { maxTokens: 400, temperature: 0.2 },
      }),
    );
    const summary = (res.output?.message?.content ?? [])
      .map((c) => ('text' in c ? c.text : ''))
      .join('')
      .trim();
    if (!summary) throw new Error('empty model output');

    const value: CachedSummary = {
      summary,
      modelId,
      generatedFrom: facts.fields,
      sources: p.sources.map((s) => ({ name: s.name, url: s.url, license: s.license })),
    };
    await putSummary(id, value);
    log('info', 'summary generated', { modelId, outputTokens: res.usage?.outputTokens });
    return json(200, { ...value, aiGenerated: true, cached: false }, origin);
  } catch (err) {
    log('error', 'summary failed', { error: errorName(err) });
    return errorResponse(500, 'internal_error', 'Internal error', origin);
  }
}
