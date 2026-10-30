import { App } from 'aws-cdk-lib';
import { resolveEnvironment } from '../config/environments.ts';
import { HeritageStack } from '../lib/heritage-stack.ts';

const app = new App();
const config = resolveEnvironment((key) => app.node.tryGetContext(key));

new HeritageStack(app, `HeritageTrail-${config.envName}`, {
  config,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region },
  description: `HeritageTrail India (${config.envName}): data, API, Amazon Location API key and CloudFront site`,
});
