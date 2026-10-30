import { aws_dynamodb as dynamodb, aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.ts';

/** Data bucket (raw/ and processed/) and the single DynamoDB table of ARCHITECTURE.md section 7. */
export class DataStore extends Construct {
  readonly bucket: s3.Bucket;
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, config: EnvironmentConfig) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.autoDeleteObjects,
    });

    this.table = new dynamodb.Table(this, 'SitesTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: config.removalPolicy,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
