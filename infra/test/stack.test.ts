import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../config/environments.ts';
import { HeritageStack } from '../lib/heritage-stack.ts';
import { API_KEY_ACTIONS } from '../lib/constructs/location.ts';
// A one-file site fixture stands in for frontend/dist, so these tests do not need a frontend build.
const SITE_FIXTURE = fileURLToPath(new URL('./fixtures/site', import.meta.url));
function synth(context: Record<string, unknown> = {}): Template {
  const app = new App({
    context: {
      '@aws-cdk/aws-iam:minimizePolicies': true,
      // Skip esbuild bundling of the Lambdas: the template shape does not depend on the bundle.
      'aws:cdk:bundling-stacks': [],
      ...context,
    },
  });
  const config = resolveEnvironment((key) => app.node.tryGetContext(key));
  const stack = new HeritageStack(app, `HeritageTrail-${config.envName}`, {
    config,
    env: { region: config.region },
    siteAssetPath: SITE_FIXTURE,
  });
  return Template.fromStack(stack);
}
type Json = Record<string, any>;
/** Renders CloudFormation intrinsics as readable strings: Ref -> ${X}, GetAtt -> ${X.Y}, Join concatenated. */
function flat(v: unknown): string {
  if (typeof v === 'string') return v;
  const o = v as Json;
  if (o?.Ref) return o.Ref === 'AWS::Partition' ? 'aws' : `\${${o.Ref}}`;
  if (o?.['Fn::GetAtt']) return `\${${(o['Fn::GetAtt'] as string[]).join('.')}}`;
  if (o?.['Fn::Join']) return (o['Fn::Join'][1] as unknown[]).map(flat).join(o['Fn::Join'][0] as string);
  return JSON.stringify(v);
}
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
function statements(t: Template): Json[] {
  const out: Json[] = [];
  for (const r of Object.values(t.findResources('AWS::IAM::Policy'))) out.push(...list(r.Properties.PolicyDocument.Statement as Json[]));
  for (const r of Object.values(t.findResources('AWS::IAM::Role'))) {
    for (const p of list(r.Properties.Policies as Json[])) out.push(...list(p.PolicyDocument.Statement as Json[]));
  }
  return out;
}
const appFunctions = (t: Template) =>
  Object.values(t.findResources('AWS::Lambda::Function')).filter((r) => r.Properties.Environment?.Variables?.TABLE_NAME);
const enabled = synth();
const disabled = synth({ enableSummaries: 'false' });
describe('HeritageStack (dev, summaries enabled)', () => {
  it('restricts the Amazon Location API key to exactly the browser actions, provider resources and site origins', () => {
    const keys = Object.values(enabled.findResources('AWS::Location::APIKey'));
    expect(keys).toHaveLength(1);
    const r = keys[0]!.Properties.Restrictions as Json;
    expect(Object.keys(r).sort()).toEqual(['AllowActions', 'AllowReferers', 'AllowResources']);
    expect(r.AllowActions).toEqual([
      'geo-maps:GetTile',
      'geo-maps:GetStaticMap',
      'geo-places:Geocode',
      'geo-places:Autocomplete',
      'geo-places:SearchText',
      'geo-routes:CalculateRoutes',
    ]);
    expect(r.AllowActions).toEqual(API_KEY_ACTIONS);
    expect((r.AllowResources as unknown[]).map(flat)).toEqual([
      'arn:aws:geo-maps:us-east-1::provider/default',
      'arn:aws:geo-places:us-east-1::provider/default',
      'arn:aws:geo-routes:us-east-1::provider/default',
    ]);
    const referers = (r.AllowReferers as unknown[]).map(flat);
    expect(referers).toHaveLength(3);
    expect(referers[0]).toMatch(/^https:\/\/\$\{FrontendDistribution[A-Z0-9]+\.DomainName\}\/\*$/);
    expect(referers.slice(1)).toEqual(['http://localhost:5173/*', 'http://localhost:4173/*']);
  });
  it('runs every application Lambda on nodejs22.x arm64', () => {
    const fns = appFunctions(enabled);
    expect(fns).toHaveLength(3);
    for (const f of fns) {
      expect(f.Properties.Runtime).toBe('nodejs22.x');
      expect(f.Properties.Architectures).toEqual(['arm64']);
    }
  });
  it('has no IAM statement with Action "*" or a service-wide wildcard', () => {
    const actions = statements(enabled).flatMap((s) => list<string>(s.Action));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).not.toContain('*');
    expect(actions.filter((a) => /^[a-z0-9-]+:\*$/i.test(a))).toEqual([]);
    for (const a of ['dynamodb:*', 's3:*', 'bedrock:*']) expect(actions).not.toContain(a);
  });
  it('limits bedrock:InvokeModel to the inference profile and its three foundation models', () => {
    const invoke = statements(enabled).filter((s) => list<string>(s.Action).some((a) => a.startsWith('bedrock:')));
    expect(invoke).toHaveLength(1);
    expect(list(invoke[0]!.Action)).toEqual(['bedrock:InvokeModel']);
    expect(list(invoke[0]!.Resource).map(flat).sort()).toEqual(
      [
        'arn:aws:bedrock:us-east-1:${AWS::AccountId}:inference-profile/us.amazon.nova-2-lite-v1:0',
        'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-2-lite-v1:0',
        'arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-2-lite-v1:0',
        'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-2-lite-v1:0',
      ].sort(),
    );
  });
  it('exposes POST /sites/{id}/summary backed by the summary Lambda', () => {
    const summary = appFunctions(enabled).filter((f) => f.Properties.Environment.Variables.BEDROCK_MODEL_ID);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.Properties.Environment.Variables).toMatchObject({ BEDROCK_MODEL_ID: 'us.amazon.nova-2-lite-v1:0', BEDROCK_REGION: 'us-east-1' });
    const paths = Object.values(enabled.findResources('AWS::ApiGateway::Resource')).map((r) => r.Properties.PathPart);
    expect(paths).toContain('summary');
  });
  it('blocks all public access on every bucket and denies non-TLS requests', () => {
    const buckets = enabled.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(2);
    const policies = Object.values(enabled.findResources('AWS::S3::BucketPolicy'));
    for (const [id, b] of Object.entries(buckets)) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      const policy = policies.find((p) => p.Properties.Bucket?.Ref === id);
      expect(policy, `bucket policy for ${id}`).toBeDefined();
      const deny = list<Json>(policy!.Properties.PolicyDocument.Statement).find(
        (s) => s.Effect === 'Deny' && s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
      );
      expect(deny, `aws:SecureTransport deny on ${id}`).toBeDefined();
      expect(list(deny!.Action)).toEqual(['s3:*']);
    }
  });
  it('serves the site through CloudFront with origin access control (no OAI)', () => {
    const oac = Object.values(enabled.findResources('AWS::CloudFront::OriginAccessControl'));
    expect(oac).toHaveLength(1);
    expect(oac[0]!.Properties.OriginAccessControlConfig).toMatchObject({
      OriginAccessControlOriginType: 's3',
      SigningBehavior: 'always',
      SigningProtocol: 'sigv4',
    });
    expect(Object.keys(enabled.findResources('AWS::CloudFront::CloudFrontOriginAccessIdentity'))).toHaveLength(0);
    const dist = Object.values(enabled.findResources('AWS::CloudFront::Distribution'))[0]!.Properties.DistributionConfig as Json;
    expect(dist.Origins).toHaveLength(1);
    expect(dist.Origins[0].OriginAccessControlId['Fn::GetAtt'][1]).toBe('Id');
    expect(dist.Origins[0].S3OriginConfig).toEqual({ OriginAccessIdentity: '' });
    expect(dist.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
  });
  it('validates request parameters on every non-OPTIONS method', () => {
    const validators = enabled.findResources('AWS::ApiGateway::RequestValidator');
    const [validatorId, validator] = Object.entries(validators)[0]!;
    expect(Object.keys(validators)).toHaveLength(1);
    expect(validator.Properties).toMatchObject({ ValidateRequestParameters: true, ValidateRequestBody: false });
    const methods = Object.values(enabled.findResources('AWS::ApiGateway::Method')).filter((m) => m.Properties.HttpMethod !== 'OPTIONS');
    expect(methods.map((m) => m.Properties.HttpMethod).sort()).toEqual(['GET', 'GET', 'GET', 'GET', 'POST']);
    for (const m of methods) expect(m.Properties.RequestValidatorId).toEqual({ Ref: validatorId });
    const nearby = methods.find((m) => m.Properties.RequestParameters?.['method.request.querystring.lat'] !== undefined);
    expect(nearby!.Properties.RequestParameters).toEqual({
      'method.request.querystring.lat': true,
      'method.request.querystring.lon': true,
      'method.request.querystring.radiusKm': false,
      'method.request.querystring.limit': false,
    });
  });
});
describe('HeritageStack with -c enableSummaries=false', () => {
  it('has no summary Lambda, no summary route and no Bedrock permission', () => {
    const fns = appFunctions(disabled);
    expect(fns).toHaveLength(2);
    expect(fns.some((f) => f.Properties.Environment.Variables.BEDROCK_MODEL_ID)).toBe(false);
    const paths = Object.values(disabled.findResources('AWS::ApiGateway::Resource')).map((r) => r.Properties.PathPart);
    expect(paths).not.toContain('summary');
    expect(statements(disabled).flatMap((s) => list<string>(s.Action)).some((a) => a.startsWith('bedrock:'))).toBe(false);
    expect(JSON.stringify(disabled.toJSON())).not.toMatch(/bedrock/i);
  });
});
