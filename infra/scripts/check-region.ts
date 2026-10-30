/**
 * Read-only checks that the configured region supports everything the stack needs. Creates nothing.
 * Usage: npm run check:region -w infra [-- --env dev|prod] [-- --region <r>] [-- --bedrockRegion <r>]
 * Uses the default AWS credential chain of the caller.
 */
import { BedrockClient, GetInferenceProfileCommand } from '@aws-sdk/client-bedrock';
import { GeoMapsClient, GetStyleDescriptorCommand } from '@aws-sdk/client-geo-maps';
import { GeocodeCommand, GeoPlacesClient } from '@aws-sdk/client-geo-places';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { ListKeysCommand, LocationClient } from '@aws-sdk/client-location';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { resolveEnvironment } from '../config/environments.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const config = resolveEnvironment((key) => arg(key));
const { region, bedrockRegion, bedrockModelId } = config;

interface Row {
  check: string;
  region: string;
  ok: boolean;
  detail: string;
}
const rows: Row[] = [];

async function check(name: string, r: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  try {
    rows.push({ check: name, region: r, ...(await fn()) });
  } catch (err) {
    const e = err as Error;
    rows.push({ check: name, region: r, ok: false, detail: `${e.name}: ${e.message}`.slice(0, 160) });
  }
}

await check('sts GetCallerIdentity', region, async () => {
  const id = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  return { ok: Boolean(id.Account), detail: `account ${id.Account}` };
});

await check('geo-maps GetStyleDescriptor Standard', region, async () => {
  const res = await new GeoMapsClient({ region }).send(new GetStyleDescriptorCommand({ Style: 'Standard' }));
  const bytes = res.Blob?.byteLength ?? 0;
  return { ok: bytes > 0, detail: `${bytes} bytes` };
});

await check('geo-places Geocode "Thanjavur" (IND)', region, async () => {
  const res = await new GeoPlacesClient({ region }).send(
    new GeocodeCommand({ QueryText: 'Thanjavur', Filter: { IncludeCountries: ['IND'] }, MaxResults: 1 }),
  );
  const top = res.ResultItems?.[0];
  return { ok: Boolean(top?.Position), detail: top ? `${top.Title} at [${top.Position?.join(', ')}]` : 'no result' };
});

await check('geo-routes CalculateRoutes Chennai -> Mahabalipuram', region, async () => {
  const res = await new GeoRoutesClient({ region }).send(
    new CalculateRoutesCommand({
      Origin: [80.2707, 13.0827],
      Destination: [80.1989, 12.6175],
      TravelMode: 'Car',
      LegGeometryFormat: 'Simple',
    }),
  );
  const route = res.Routes?.[0];
  const points = (route?.Legs ?? []).reduce((n, l) => n + (l.Geometry?.LineString?.length ?? 0), 0);
  const metres = route?.Summary?.Distance;
  return { ok: Boolean(metres && points > 1), detail: `${metres} m, ${points} points` };
});

await check(`bedrock GetInferenceProfile ${bedrockModelId}`, bedrockRegion, async () => {
  const res = await new BedrockClient({ region: bedrockRegion }).send(
    new GetInferenceProfileCommand({ inferenceProfileIdentifier: bedrockModelId }),
  );
  const modelRegions = (res.models ?? [])
    .map((m) => /^arn:[^:]+:bedrock:([^:]+)::/.exec(m.modelArn ?? '')?.[1])
    .filter((r): r is string => Boolean(r))
    .sort();
  const expected = [...config.bedrockModelRegions].sort();
  const matches = JSON.stringify(modelRegions) === JSON.stringify(expected);
  return {
    ok: res.status === 'ACTIVE' && matches,
    detail: `${res.status}; model regions ${modelRegions.join(', ')}${matches ? '' : ` (config expects ${expected.join(', ')})`}`,
  };
});

await check('location ListKeys', region, async () => {
  const res = await new LocationClient({ region }).send(new ListKeysCommand({}));
  const names = (res.Entries ?? []).map((k) => k.KeyName);
  const target = `heritagetrail-${config.envName}`;
  return {
    ok: true,
    detail: `${names.length} key(s)${names.includes(target) ? `; ${target} already exists` : `; ${target} not present`}`,
  };
});

const width = Math.max(...rows.map((r) => r.check.length));
console.log(`HeritageTrail region check (env ${config.envName}, region ${region}, bedrock ${bedrockRegion})`);
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check.padEnd(width)}  ${r.region.padEnd(12)}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exitCode = failed ? 1 : 0;
