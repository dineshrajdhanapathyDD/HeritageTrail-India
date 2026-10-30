import { aws_iam as iam, aws_location as location, Stack } from 'aws-cdk-lib';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.ts';

/** Read-only browser actions on the V2 provider resources (plan decision 6). */
export const API_KEY_ACTIONS = [
  'geo-maps:GetTile',
  'geo-maps:GetStaticMap',
  'geo-places:Geocode',
  'geo-places:Autocomplete',
  'geo-places:SearchText',
  'geo-routes:CalculateRoutes',
];

export interface LocationProps {
  config: EnvironmentConfig;
  /** Origins such as https://dxxxx.cloudfront.net; each becomes a `<origin>/*` referer pattern. */
  allowedOrigins: string[];
}

/** Amazon Location API key (V2 APIs need no map, place index or route calculator resources). */
export class Location extends Construct {
  readonly apiKey: location.CfnAPIKey;
  /** Key value, read at deploy time with location:DescribeKey and written into the site's config.json. */
  readonly apiKeyValue: string;

  constructor(scope: Construct, id: string, props: LocationProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const keyName = `heritagetrail-${props.config.envName}`;
    const provider = (service: string) => `arn:${stack.partition}:${service}:${stack.region}::provider/default`;

    this.apiKey = new location.CfnAPIKey(this, 'ApiKey', {
      keyName,
      description: 'HeritageTrail India browser key: map tiles, geocoding and routing only',
      noExpiry: true,
      restrictions: {
        allowActions: API_KEY_ACTIONS,
        allowResources: [provider('geo-maps'), provider('geo-places'), provider('geo-routes')],
        allowReferers: props.allowedOrigins.map((o) => `${o}/*`),
      },
    });

    const describe = {
      service: 'Location',
      action: 'describeKey',
      parameters: { KeyName: keyName },
      physicalResourceId: PhysicalResourceId.of(`${keyName}-describe`),
      outputPaths: ['Key'],
    };
    const reader = new AwsCustomResource(this, 'DescribeKey', {
      onCreate: describe,
      onUpdate: describe,
      installLatestAwsSdk: false,
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ['geo:DescribeKey'], resources: [this.apiKey.attrArn] }),
      ]),
    });
    reader.node.addDependency(this.apiKey);
    this.apiKeyValue = reader.getResponseField('Key');
  }
}
