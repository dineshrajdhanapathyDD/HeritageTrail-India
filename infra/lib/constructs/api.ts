import {
  aws_apigateway as apigw,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_notifications as s3n,
  Duration,
  Stack,
} from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.ts';
import { REPO_ROOT, repoPath } from '../paths.ts';
import type { DataStore } from './data-store.ts';

export interface ApiProps {
  config: EnvironmentConfig;
  data: DataStore;
}

/**
 * REST API (API Gateway v1) and the three Lambdas of plan decision 21.
 * The RestApi is created first so its ID can go into the CloudFront CSP; routes and functions are added by
 * `addRoutes` once the CloudFront domain (needed for CORS) exists. This order avoids a dependency cycle.
 */
export class Api extends Construct {
  readonly restApi: apigw.RestApi;
  readonly functions: lambda.IFunction[] = [];
  summaryFunction?: NodejsFunction;
  private readonly props: ApiProps;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    this.props = props;
    const { config } = props;
    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });
    this.restApi = new apigw.RestApi(this, 'RestApi', {
      restApiName: `heritagetrail-${config.envName}`,
      description: 'HeritageTrail India read API and optional grounded summaries',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      // Access logging uses the account-level API Gateway CloudWatch role, which already exists in the
      // target account (owned by another stack). User choice: do not take it over.
      cloudWatchRole: false,
      deployOptions: {
        stageName: config.envName,
        throttlingRateLimit: config.throttle.rateLimit,
        throttlingBurstLimit: config.throttle.burstLimit,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        // No caller IP or user identity in access logs.
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: false,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: false,
        }),
        dataTraceEnabled: false,
      },
    });
  }

  /** Base URL without trailing slash, e.g. https://<id>.execute-api.<region>.amazonaws.com/dev */
  get baseUrl(): string {
    const stack = Stack.of(this);
    return `https://${this.restApi.restApiId}.execute-api.${stack.region}.${stack.urlSuffix}/${this.props.config.envName}`;
  }

  private fn(id: string, entry: string, opts: { memorySize: number; timeout: Duration; environment: Record<string, string> }) {
    const { config } = this.props;
    const logGroup = new logs.LogGroup(this, `${id}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });
    const f = new NodejsFunction(this, id, {
      entry: repoPath('backend', 'src', 'handlers', entry),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: opts.memorySize,
      timeout: opts.timeout,
      logGroup,
      projectRoot: REPO_ROOT,
      depsLockFilePath: repoPath('package-lock.json'),
      environment: { NODE_OPTIONS: '--enable-source-maps', ...opts.environment },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: OutputFormat.CJS,
        externalModules: [],
        forceDockerBundling: false,
      },
    });
    this.functions.push(f);
    return f;
  }

  addRoutes(allowedOrigins: string[]): void {
    const { config, data } = this.props;
    const table = data.table;
    const tableArns = [table.tableArn, `${table.tableArn}/index/*`];
    const common = { TABLE_NAME: table.tableName, ALLOWED_ORIGINS: allowedOrigins.join(',') };

    // api: read-only DynamoDB on the table and its GSIs.
    const apiFn = this.fn('ApiFunction', 'api.ts', { memorySize: 256, timeout: Duration.seconds(10), environment: common });
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Query'], resources: tableArns }));

    // ingest: read processed/* objects, write/delete/query site items.
    const ingestFn = this.fn('IngestFunction', 'ingest.ts', {
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: { TABLE_NAME: table.tableName },
    });
    ingestFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [data.bucket.arnForObjects('processed/*')] }));
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:BatchWriteItem', 'dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Query'],
        resources: tableArns,
      }),
    );
    data.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(ingestFn), {
      prefix: 'processed/',
      suffix: '.geojson',
    });

    const validator = new apigw.RequestValidator(this, 'ParamsValidator', {
      restApi: this.restApi,
      requestValidatorName: 'params',
      validateRequestParameters: true,
      validateRequestBody: false,
    });
    const cors: apigw.CorsOptions = {
      allowOrigins: allowedOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: Duration.hours(1),
    };
    const integration = new apigw.LambdaIntegration(apiFn, { allowTestInvoke: false });
    const qs = (required: string[], optional: string[] = []) => ({
      ...Object.fromEntries(required.map((p) => [`method.request.querystring.${p}`, true])),
      ...Object.fromEntries(optional.map((p) => [`method.request.querystring.${p}`, false])),
    });

    const sites = this.restApi.root.addResource('sites', { defaultCorsPreflightOptions: cors });
    sites.addMethod('GET', integration, {
      requestValidator: validator,
      requestParameters: qs(['state'], ['category', 'period', 'q', 'limit', 'nextToken']),
    });
    sites.addResource('nearby').addMethod('GET', integration, {
      requestValidator: validator,
      requestParameters: qs(['lat', 'lon'], ['radiusKm', 'limit']),
    });
    const site = sites.addResource('{id}');
    site.addMethod('GET', integration, {
      requestValidator: validator,
      requestParameters: { 'method.request.path.id': true },
    });
    this.restApi.root.addResource('stats', { defaultCorsPreflightOptions: cors }).addMethod('GET', integration, {
      requestValidator: validator,
      requestParameters: qs(['state']),
    });

    if (!config.enableSummaries) return;

    // summary: cache GetItem/PutItem on the base table and InvokeModel on exactly the profile and its models.
    const summaryFn = this.fn('SummaryFunction', 'summary.ts', {
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: { ...common, BEDROCK_REGION: config.bedrockRegion, BEDROCK_MODEL_ID: config.bedrockModelId },
    });
    summaryFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], resources: [table.tableArn] }),
    );
    const stack = Stack.of(this);
    const foundationModelId = config.bedrockModelId.replace(/^(us|eu|apac|global)\./, '');
    summaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:${stack.partition}:bedrock:${config.bedrockRegion}:${stack.account}:inference-profile/${config.bedrockModelId}`,
          ...config.bedrockModelRegions.map(
            (r) => `arn:${stack.partition}:bedrock:${r}::foundation-model/${foundationModelId}`,
          ),
        ],
      }),
    );
    site.addResource('summary').addMethod('POST', new apigw.LambdaIntegration(summaryFn, { allowTestInvoke: false }), {
      requestValidator: validator,
      requestParameters: { 'method.request.path.id': true },
    });
    this.summaryFunction = summaryFn;
  }
}
