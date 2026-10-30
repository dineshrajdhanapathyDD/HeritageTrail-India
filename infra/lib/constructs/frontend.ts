import { existsSync } from 'node:fs';
import {
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  Duration,
  Stack,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.ts';
import { repoPath } from '../paths.ts';

export interface FrontendProps {
  config: EnvironmentConfig;
  /** RestApi ID only (not the stage URL) so the CSP does not depend on API methods and Lambdas. */
  restApiId: string;
}

export interface SiteConfigJson {
  region: string;
  locationApiKey: string;
  mapStyle: string;
  apiBaseUrl: string;
  summariesEnabled: boolean;
}

/** Content-Security-Policy for the SPA: Amazon Location V2 endpoints, the API, and Commons image hotlinks. */
export function contentSecurityPolicy(region: string, restApiId: string, urlSuffix: string): string {
  const geo = [
    `https://maps.geo.${region}.${urlSuffix}`,
    `https://places.geo.${region}.${urlSuffix}`,
    `https://routes.geo.${region}.${urlSuffix}`,
    `https://geo-places.${region}.${urlSuffix}`,
    `https://geo-routes.${region}.${urlSuffix}`,
  ];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://upload.wikimedia.org https://thumb.wikimedia.org https://maps.geo.${region}.${urlSuffix}`,
    "font-src 'self' data:",
    `connect-src 'self' ${geo.join(' ')} https://${restApiId}.execute-api.${region}.${urlSuffix}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Private site bucket behind CloudFront (origin access control) with security headers and SPA fallback. */
export class Frontend extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  private readonly config: EnvironmentConfig;

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);
    this.config = props.config;
    const stack = Stack.of(this);

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: props.config.removalPolicy,
      autoDeleteObjects: props.config.autoDeleteObjects,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'HeritageTrail security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: contentSecurityPolicy(stack.region, props.restApiId, stack.urlSuffix),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        // Cross-origin requests send the origin only, which the API key referer patterns match.
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `HeritageTrail India ${props.config.envName}`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(10),
      })),
    });
  }

  /** Uploads frontend/dist plus a deploy-time /config.json, then invalidates the distribution. */
  deploySite(siteConfig: SiteConfigJson, dist = repoPath('frontend', 'dist')): s3deploy.BucketDeployment {
    if (!existsSync(dist)) throw new Error(`${dist} not found: run "npm run build -w frontend" before cdk synth`);
    return new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(dist), s3deploy.Source.jsonData('config.json', siteConfig)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
      prune: true,
    });
  }
}
