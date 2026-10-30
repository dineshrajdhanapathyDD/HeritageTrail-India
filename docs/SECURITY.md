# HeritageTrail India: Security

This document describes what the deployed stack exposes, what each component is allowed to do, and how to operate it
safely. IAM, CORS, throttling and header values below were read from the synthesized template
`infra/cdk.out/HeritageTrail-dev.template.json` (`npm run synth`, region us-east-1). Re-check them after changing
`infra/`.

## 1. Threat model

The application serves public, open-licensed heritage data. There are no user accounts, no writes from the internet
and no personal data.

| Asset or surface | Exposure | Main risks | Controls |
|---|---|---|---|
| Static site (CloudFront + S3) | Public | Content injection, clickjacking, bucket exposure | Private bucket behind CloudFront OAC, HTTPS only, CSP and security headers (section 7) |
| REST API (API Gateway + Lambda) | Public, read-only (plus the optional summary POST) | Abuse and cost, injection through query parameters | Stage throttling, required-parameter validation in API Gateway, zod validation in the handlers, generic error bodies (section 4) |
| Amazon Location API key | Public by design: the browser needs it | Key reuse from other sites, quota abuse | Six read actions on the `provider/default` resources only, referer allow-list, rotation (section 3) |
| Summary endpoint (Bedrock) | Public POST without a body | Cost abuse, prompt injection, invented facts | Cached per site and model, stage throttling, grounded only in stored CC0 text, switchable off (section 6) |
| Data bucket and DynamoDB table | Private | Tampering with site data | Only the ingest Lambda and the CDK deployment helper can write; versioning on the data bucket; PITR on the table |
| Pipeline (local CLI) | Runs on a developer machine | Untrusted upstream responses | Responses are parsed as data and validated against the zod schema; nothing from them is executed |

Out of scope: authenticated users, payments, and any personal data (none is collected).

## 2. IAM per function

Every application Lambda has its own role. Each role has the AWS managed policy `AWSLambdaBasicExecutionRole`
(CloudWatch Logs only) plus the inline statements below. No statement in the application roles uses `Action: "*"`,
`dynamodb:*` or `s3:*` (asserted by `infra/test`).

| Function | Actions | Resources |
|---|---|---|
| `ApiFunction` (GET /sites, /sites/nearby, /sites/{id}, /stats) | `dynamodb:GetItem`, `dynamodb:Query` | the sites table and `table/index/*` |
| `IngestFunction` (S3 `ObjectCreated` on `processed/*.geojson`) | `s3:GetObject` | `<data bucket>/processed/*` |
| | `dynamodb:BatchWriteItem`, `dynamodb:DeleteItem`, `dynamodb:PutItem`, `dynamodb:Query` | the sites table and `table/index/*` |
| `SummaryFunction` (POST /sites/{id}/summary, only when summaries are on) | `dynamodb:GetItem`, `dynamodb:PutItem` | the sites table (base table only) |
| | `bedrock:InvokeModel` | `arn:aws:bedrock:us-east-1:<account>:inference-profile/us.amazon.nova-2-lite-v1:0` and `arn:aws:bedrock:{us-east-1,us-east-2,us-west-2}::foundation-model/amazon.nova-2-lite-v1:0` |

The model regions are the ones the `us.amazon.nova-2-lite-v1:0` inference profile routes to (read with
`bedrock GetInferenceProfile` by `npm run check:region -w infra`). If you change `-c bedrockModelId`, update
`bedrockModelRegions` in `infra/config/environments.ts` to match the new profile.

Roles created by CDK constructs (not application code):

| Role | Permissions | Purpose |
|---|---|---|
| Bucket notifications handler | `s3:PutBucketNotification` on the data bucket | Wires the S3 event to `IngestFunction` |
| Auto-delete objects provider (dev only) | Bucket policy grant: `s3:DeleteObject*`, `s3:GetBucket*`, `s3:List*`, `s3:PutBucketPolicy` on both buckets | Empties buckets on `cdk destroy` |
| `DescribeKey` custom resource | `geo:DescribeKey` on the stack's API key ARN | Reads the key value at deploy time to write `config.json` |
| `BucketDeployment` | Read on the CDK assets bucket; object read/write/delete on the data and site buckets; `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` on `*` | Uploads the site, `config.json` and data; invalidates CloudFront. The `*` resource is set by CDK |
| API Gateway CloudWatch role | Not created by this stack (`cloudWatchRole: false`) | Access logs use the account's existing API Gateway CloudWatch role. The stack does not replace an account-wide setting another stack owns |

## 3. Amazon Location API key

The browser gets the key from `/config.json`, which the CDK deployment writes next to the site. The key is never in
source code, `.env.example` or the build output. Anyone who opens the site can read it, so its power is limited:

- **Actions (exactly six):** `geo-maps:GetTile`, `geo-maps:GetStaticMap`, `geo-places:Geocode`,
  `geo-places:Autocomplete`, `geo-places:SearchText`, `geo-routes:CalculateRoutes`.
- **Resources:** `arn:aws:geo-maps:<region>::provider/default`, `arn:aws:geo-places:<region>::provider/default`,
  `arn:aws:geo-routes:<region>::provider/default`.
- **Referers:** `https://<cloudfront domain>/*`; in `dev` also `http://localhost:5173/*` and `http://localhost:4173/*`
  (local dev and preview). `prod` allows only the CloudFront domain. Referer checks stop casual reuse from other
  websites; a non-browser client can fake the header, so the throttling and quotas of Amazon Location are the final
  limit.
- **Expiry:** the key is created with `NoExpiry: true` so the site keeps working. Rotate it on a schedule.
- The key value also appears in the `DescribeKey` custom resource response stored by CloudFormation. This is
  acceptable for a public browser key; do not reuse the pattern for secrets.

**Rotation procedure**

1. In `infra/lib/constructs/location.ts`, change `keyName` (for example `heritagetrail-${envName}-2`). Per the
   CloudFormation reference for `AWS::Location::APIKey`, changing `KeyName` requires replacement, so CloudFormation
   creates the new key first.
2. Run steps 5 and 7 of the deployment path in the README (`npm run synth`, `npx cdk deploy -c env=dev`). The
   deployment writes the new key into `config.json` and invalidates CloudFront.
3. Check the site loads tiles and routes with the new key.
4. CloudFormation then deletes the old key. If that delete fails (Amazon Location protects keys that were used
   recently or have no expiry), delete it yourself after confirming nothing uses it:
   `aws location delete-key --key-name <old name> --force-delete --region <region>`.

If a key leaks into a place it should not be (for example a public issue), rotate it immediately.

## 4. API Gateway: CORS, throttling and validation

- **Stage throttling:** 20 requests per second, burst 40, on every method (`MethodSettings` `/*`). Adjust in
  `infra/config/environments.ts` (`throttle`).
- **Request validation:** a `params` request validator requires the mandatory parameters per route
  (`state` on `/sites` and `/stats`; `lat`, `lon` on `/sites/nearby`; the `{id}` path on `/sites/{id}` and
  `/sites/{id}/summary`). Requests without them get HTTP 400 from API Gateway before any Lambda runs.
- **Handler validation (zod, `backend/src/lib/params.ts`):** `state` must match `IN-XX` (ISO 3166-2:IN); `category` from the
  fixed list; `period` `known` or `unknown`; `q` 1 to 100 characters; `limit` 1 to 200; `lat`/`lon` inside the
  India bounding box; `radiusKm` 1 to 100; site IDs must match `wd-Q<digits>` or `osm-(node|way|relation)-<digits>`;
  `nextToken` is 1 to 2048 characters of letters, digits, `-` and `_`.
  Invalid requests return HTTP 400 with the parameter names only; values are never echoed.
- **Errors:** responses carry a stable error code and a fixed message, no stack traces.
- **CORS:** preflight `OPTIONS` allows `GET`, `POST`, `OPTIONS` and `Content-Type` for the allowed origins
  (the CloudFront domain, plus the two localhost origins in `dev`). The handlers return
  `Access-Control-Allow-Origin` only when the request `Origin` is on that list (`ALLOWED_ORIGINS`), and set
  `Vary: Origin`.
- **Access logs:** JSON with request ID, time, method, resource path, status, protocol and response length.
  Source IP, caller and user fields are not logged. Data tracing (full request/response logging) is off.

## 5. Data handling: no personal data, no secrets

- The processed data contains heritage site facts and source references only. The only person-related field is the
  Commons `Artist` string, kept because the image licence requires attribution, and shown only next to the image.
- Contact tags (`phone`, `mobile`, `fax`, `email`, `contact:*`) are removed from Overpass responses before the raw
  copies in `data/raw/` are written (`scrubContactTags` in `pipeline/src/rawStore.ts`), so neither the raw copies nor
  the processed output contain phone numbers or email addresses. A pipeline test checks the committed raw copy.
- No secrets exist in the repository. The frontend has no AWS credentials; it uses only the public, restricted
  Location API key from `/config.json`. `.env*.local` files are gitignored.
- Lambda logs are structured JSON with route names, counts and error class names only. Request bodies, query values
  and keys are not logged.
- The pipeline sends a descriptive `User-Agent` to public APIs and stores no credentials (none are needed).

## 6. Amazon Bedrock summaries

- **Data flow:** the browser calls `POST /sites/{id}/summary`. `SummaryFunction` reads the stored record from
  DynamoDB and sends only stored fields (name, Wikidata description, category, designations, period label,
  district, state, UNESCO status, source names and URLs) to Amazon Bedrock `Converse` with the system prompt in
  `backend/src/handlers/summary.ts`, which forbids adding facts that are not in that text. All descriptions in the
  Tamil Nadu data come from Wikidata (CC0). Nothing the user types is sent to the model.
- **Region:** requests go to Bedrock in **us-east-1** using the cross-region inference profile
  `us.amazon.nova-2-lite-v1:0`, which may serve them in us-east-1, us-east-2 or us-west-2.
- **Abuse limits:** sites without a stored description get HTTP 422 and no model call. Each summary is cached in
  DynamoDB per site and model ID, so repeated requests do not call Bedrock again. Stage throttling applies.
  Responses are labelled `aiGenerated: true` with the model ID and the sources used.
- **Switch off:** deploy with `-c enableSummaries=false`. The summary Lambda, its role, the Bedrock permissions and the
  POST route are then not created, and `config.json` sets `summariesEnabled: false`.

## 7. Storage and delivery

- **S3 (data and site buckets):** S3-managed encryption (SSE-S3, AES256), all four Block Public Access settings on,
  `BucketOwnerEnforced` object ownership (ACLs disabled), and a bucket policy that denies any request without TLS
  (`aws:SecureTransport = false`). The data bucket has versioning.
- **DynamoDB:** encryption at rest (`SSESpecification`), point-in-time recovery, on-demand billing.
- **CloudFront:** origin access control (SigV4, always sign); the site bucket allows `s3:GetObject` only to the
  `cloudfront.amazonaws.com` principal for this distribution (`AWS:SourceArn`). Viewers are redirected to HTTPS.
- **Security headers (response headers policy):**
  - `Content-Security-Policy`: `default-src 'self'`; `script-src 'self'`; `style-src 'self' 'unsafe-inline'`
    (MapLibre and Framer Motion set inline styles); `img-src 'self' data: blob:` plus `upload.wikimedia.org`,
    `thumb.wikimedia.org` and `maps.geo.<region>.amazonaws.com`; `connect-src 'self'` plus the Amazon Location maps,
    places and routes endpoints for the region and this stack's API Gateway origin; `worker-src`/`child-src 'self'
    blob:`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`,
    `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Wikimedia Commons images** are hotlinked (`<img referrerPolicy="no-referrer">`), not copied. Commons recommends
  against hotlinking for high-traffic reuse; if traffic grows, mirror the files with their licence data into the data
  bucket instead.

## 8. Dependencies

- Vulnerabilities: `npm audit --omit=dev` (0 vulnerabilities on 2026-10-30). `maplibre-gl` is pinned to `^6.16.0` because
  `npm audit` reports advisory GHSA-jrc7-96c5-q579 for versions up to 6.4.0.
- Licences: `npm run license:audit` lists the licence of every production package resolved by
  `npm ls --omit=dev --all` and fails on anything outside the permissive allow-list or the reviewed list.
- Lambda bundles are built locally with esbuild from the locked versions in `package-lock.json`; use `npm ci`.

## 9. Reporting a security issue

Do not open a public issue for a vulnerability or a leaked key. Contact the repository owner privately (for example
through the hosting platform's private vulnerability reporting) with the affected component, steps to reproduce and
the impact. For a leaked Amazon Location key, rotate it first (section 3).
