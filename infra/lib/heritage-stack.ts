import { aws_s3_deployment as s3deploy, CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { Api } from './constructs/api.ts';
import { DataStore } from './constructs/data-store.ts';
import { Frontend } from './constructs/frontend.ts';
import { Location } from './constructs/location.ts';
import { repoPath } from './paths.ts';

export interface HeritageStackProps extends StackProps {
  config: EnvironmentConfig;
}

export class HeritageStack extends Stack {
  constructor(scope: Construct, id: string, props: HeritageStackProps) {
    super(scope, id, props);
    const { config } = props;

    const data = new DataStore(this, 'Data', config);
    const api = new Api(this, 'Api', { config, data });
    const frontend = new Frontend(this, 'Frontend', { config, restApiId: api.restApi.restApiId });

    const siteOrigin = `https://${frontend.distribution.distributionDomainName}`;
    const allowedOrigins = [siteOrigin, ...config.extraAllowedOrigins];
    api.addRoutes(allowedOrigins);

    const loc = new Location(this, 'Location', { config, allowedOrigins });

    frontend.deploySite({
      region: config.region,
      locationApiKey: loc.apiKeyValue,
      mapStyle: config.mapStyle,
      apiBaseUrl: api.baseUrl,
      summariesEnabled: config.enableSummaries,
    });

    // Data uploads: processed GeoJSON (triggers ingest) and the raw source copies for provenance.
    const processed = new s3deploy.BucketDeployment(this, 'DeployProcessedData', {
      sources: [s3deploy.Source.asset(repoPath('data', 'processed'))],
      destinationBucket: data.bucket,
      destinationKeyPrefix: 'processed/',
      memoryLimit: 512,
    });
    // The ingest notification must exist before the first upload.
    const notifications = data.bucket.node.tryFindChild('Notifications');
    if (notifications) processed.node.addDependency(notifications);
    for (const fn of api.functions) processed.node.addDependency(fn);

    new s3deploy.BucketDeployment(this, 'DeployRawData', {
      sources: [s3deploy.Source.asset(repoPath('data', 'raw'), { exclude: ['boundaries', 'boundaries/**'] })],
      destinationBucket: data.bucket,
      destinationKeyPrefix: 'raw/',
      memoryLimit: 512,
    });

    new CfnOutput(this, 'CloudFrontUrl', { value: siteOrigin });
    new CfnOutput(this, 'ApiUrl', { value: api.baseUrl });
    new CfnOutput(this, 'DataBucketName', { value: data.bucket.bucketName });
    new CfnOutput(this, 'TableName', { value: data.table.tableName });
    new CfnOutput(this, 'LocationApiKeyName', { value: loc.apiKey.keyName });
    new CfnOutput(this, 'SummariesEnabled', { value: String(config.enableSummaries) });
  }
}
