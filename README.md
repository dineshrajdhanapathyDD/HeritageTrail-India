# HeritageTrail India

A map-first web app for exploring India's heritage sites: temples, forts, monuments, museums, archaeological sites
and UNESCO World Heritage components. The first state covered is **Tamil Nadu (629 sites, 365 verified)**; the data
pipeline, API and frontend are built per state, so other states are a configuration change.

All site data comes from open sources that were checked by hand (Wikidata, OpenStreetMap, Wikimedia Commons,
geoBoundaries). Every record keeps its source URLs, licence and verification status. See
[docs/DATASETS.md](docs/DATASETS.md) for the research behind each source.

Features:

- India map (Amazon Location Service through MapLibre GL) with per-category markers, clustering, state and district
  boundaries, and a legend with data attribution.
- Search by name, state, district or category; filters by type, historical period, UNESCO status and verification.
- Details panel: name, coordinates, state, district, category, history text, Commons photo with licence and author,
  sources and verification status, and an optional AI summary grounded only in the stored source text.
- Nearby explorer: sites within a chosen radius, with distances, drawn on the map.
- Heritage routes: pick several sites and get the road route, geometry and distance from Amazon Location routing.
- Insights: totals, sites by category and district, district density map layer, all computed from the ingested data.
- Works fully offline against the committed Tamil Nadu GeoJSON (with a plain basemap) for local testing.

## Architecture


<img width="1662" height="820" alt="map drawio" src="https://github.com/user-attachments/assets/5b0b1f04-c3cb-47fd-951f-285125f6e59f" />


- The frontend renders the static GeoJSON from `/data` for the map, search, filters, nearby and insights. It calls
  Amazon Location directly with a public, restricted API key, and the REST API only for AI summaries.
- The REST API (`GET /sites`, `GET /sites/nearby`, `GET /sites/{id}`, `GET /stats`,
  `POST /sites/{id}/summary`) serves the DynamoDB copy of the same data.
- Default region **us-east-1** for every resource (Amazon Location V2 maps, places and routes and the Nova model were
  checked there read-only with `npm run check:region -w infra`). Bedrock runs in us-east-1 with the inference
  profile `us.amazon.nova-2-lite-v1:0`.

Details, design decisions, the record schema, validation and dedupe rules, the DynamoDB key design and the API
contract are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Security is in [docs/SECURITY.md](docs/SECURITY.md).

## Repository layout

| Path | Contents |
|---|---|
| `shared/` | zod record schema, config schemas, geo helpers, site IDs (used by every workspace) |
| `pipeline/` | ingestion CLI: source adapters (`src/adapters/`), normalize, validate, dedupe, output |
| `config/` | `sources.json` (endpoints, licences, attribution), `categories.json`, `states/<slug>.json` |
| `data/raw/` | raw source responses with a manifest, used for provenance and `--offline` re-runs |
| `data/processed/` | per-state GeoJSON, quality report, `index.json`, boundary GeoJSON |
| `frontend/` | React + TypeScript + Vite + Tailwind CSS + Framer Motion app, Playwright smoke test in `e2e/` |
| `backend/` | Lambda handlers (`src/handlers/api.ts`, `ingest.ts`, `summary.ts`) and tests |
| `infra/` | AWS CDK app (`bin/app.ts`, `lib/`, `config/environments.ts`, `scripts/check-region.ts`, tests) |
| `scripts/` | `license-audit.mjs` |
| `docs/` | `DATASETS.md`, `ARCHITECTURE.md`, `SECURITY.md` |

## Prerequisites

- Node.js 22 (`.nvmrc`) and npm (developed with npm 12.2.0).
- For deployment only: AWS CLI v2 and credentials for the target account.
- Docker is **not** needed. Lambdas are bundled with the local esbuild binary.

## Setup

```powershell
npm ci
```

## Run locally

```powershell
npm run dev -w frontend
```

Open http://localhost:5173. `predev` copies `data/processed/` into `frontend/public/data/` first.

Without an API key the app runs in local mode: a built-in basemap with state and district boundaries, and all
features except place search and road routing (the route panel says so). To use Amazon Location tiles, places and
routing locally, copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_LOCATION_API_KEY` (and
`VITE_AWS_REGION` if not us-east-1). The key must allow the `http://localhost:5173/*` referer; the `dev` stack's key
does. Never put AWS credentials in that file.

Production build and preview: `npm run build -w frontend`, then `npm run preview -w frontend` (port 4173).

## Data pipeline

```powershell
npm run pipeline -- boundaries                      # download geoBoundaries ADM1/ADM2, write data/processed/boundaries/
npm run pipeline -- run --state tamil-nadu          # fetch Wikidata, Overpass, Commons; write data/processed/tamil-nadu.*
npm run pipeline -- run --state tamil-nadu --offline  # rebuild from data/raw/tamil-nadu/ without network
npm run pipeline -- run --state tamil-nadu --sources wikidata,osm-overpass   # limit to some sources
```

The offline run is deterministic: on the committed tree it reproduces `data/processed/` byte for byte
(`git diff --stat data/processed` stays empty). Live runs depend on public services: Overpass often answers 502/504
and Wikidata times out on heavy queries; the pipeline retries with a 30 s backoff (3 attempts) and records any
source failure in the report.

What the pipeline does per record: normalizes to one schema (name, coordinates, state, district, category, period,
description, sources, licence, image with licence, verification status, flags); checks the point is inside India and
inside the claimed state polygon (rejects otherwise); derives or cross-checks the district from ADM2 polygons; merges
duplicates across sources (same Wikidata QID, or same normalized name within a short distance) and flags near
duplicates it does not merge; and flags missing period, description or image.

**Add a state:** create `config/states/<slug>.json` (same fields as `tamil-nadu.json`: slug, ISO code, name, Wikidata
QID, OSM ISO code, ADM1 `shapeISO`, expected district count, optional ASI count), then run
`npm run pipeline -- boundaries` and `npm run pipeline -- run --state <slug>`. The frontend and the ingest Lambda
pick the state up from `data/processed/index.json` and `processed/<slug>.geojson`.

**Add a source:** write an adapter implementing `SourceAdapter` (`pipeline/src/adapters/types.ts`), register it in
`SITE_ADAPTERS` (`pipeline/src/run.ts`) and add its entry (endpoint, licence, attribution) to `config/sources.json`.
Only add sources whose licence allows redistribution, and record the evidence in `docs/DATASETS.md`.

## Tests

```powershell
npm run typecheck                 # all workspaces
npm test                          # Vitest in shared, pipeline, backend, frontend, infra
npx playwright install chromium   # once, from frontend/
npm run test:e2e -w frontend      # builds, serves on 4173, runs the Playwright smoke test
npm run synth                     # builds the frontend, then cdk synth (no Docker)
npm run license:audit             # production dependency licences
```

Current results (this commit): `npm test` passes in all five workspaces (shared 27, pipeline 73, backend 36,
frontend 46, infra 9 tests); the Playwright smoke test passes in Chromium; `npm run build -w frontend` and
`npm run synth` succeed.

**What has and has not been tested live.** All automated tests run offline on mocks and the committed data. The
local app was checked by hand in a browser (map, clustering, selection, search, filters, details, nearby, insights,
mobile layout).

The `dev` stack was deployed to us-east-1 on 2026-10-30 (site `https://d6thdya945lhl.cloudfront.net`, API
`https://0hi1v5hqbg.execute-api.us-east-1.amazonaws.com/dev`). These were checked live on that deployment:

- **Site:** loads from CloudFront with the security headers and `config.json`, and renders Amazon Location tiles.
- **Explore, details and Insights:** work. The Insights tab reports 629 records, 365 of them verified.
- **Road routing in the browser:** Arjuna Ratha to Alamparai Fort gives 54.2 km, about 58 min and 1,042 points.
  Amazon Location `CalculateRoutes` returned 200 and the route line draws on the map.
- **API:**
  - `GET /stats?state=IN-TN` returns 629 records, so the ingest Lambda loaded DynamoDB.
  - `GET /sites?state=IN-TN&category=fort`, `GET /sites/{id}` and `GET /sites/nearby` return data.
  - Invalid `lat` and `state` values return 400.
  - `POST /sites/{id}/summary` returned a Bedrock Nova 2 Lite summary grounded in the stored fields.

Place search (`Geocode`/`Autocomplete`) was not exercised in the deployed app. The browser console shows only
MapLibre style-expression warnings from the Amazon Location Standard style and no errors.

## Deployment

One path, from a clean checkout on Windows PowerShell (the same commands work in a POSIX shell). Deploying creates
billable resources in your AWS account.

1. **Configure AWS credentials** for the target account (for example `aws configure sso` or `aws login`), then
   confirm with `aws sts get-caller-identity`.
2. **Install dependencies:** `npm ci` in the repository root.
3. **Rebuild the data** from the committed raw copies: `npm run pipeline -- run --state tamil-nadu --offline`
   (`git diff --stat data/processed` should be empty).
4. **Check the region** (read-only, makes a few Amazon Location and Bedrock read calls):
   `npm run check:region -w infra`. All checks should print PASS for us-east-1.
5. **Synthesize:** `npm run synth` (builds `frontend/dist`, bundles the Lambdas, runs `cdk synth -c env=dev`).
6. **Bootstrap CDK once per account and region**, from `infra/`:
   `npx cdk bootstrap aws://<account-id>/us-east-1`.
7. **Deploy**, from `infra/`: `npx cdk deploy -c env=dev`. Review the IAM changes CDK lists and confirm. Use
   `-c env=prod` for the production configuration (only the CloudFront origin allowed, buckets and table retained on
   delete). For another region, first check it with
   `npm run check:region -w infra -- --region <region>`, then bootstrap that region and add `-c region=<region>`.
8. **Open the site:** the stack output `CloudFrontUrl`. The deployment writes `/config.json` (region, API key, map
   style, API URL, summaries flag) and uploads `data/raw/` and `data/processed/` to the data bucket; the processed GeoJSON triggers the ingest Lambda
   to load DynamoDB. Then test routing: select two or more sites and calculate a route.
9. **Optional, AI summaries off:** deploy with `npx cdk deploy -c env=dev -c enableSummaries=false`. This removes the
   summary Lambda, its Bedrock permissions and the POST route. The model can be changed with
   `-c bedrockModelId=<inference profile id>` (also update `bedrockModelRegions` in `infra/config/environments.ts`).
10. **Tear down**, from `infra/`: `npx cdk destroy -c env=dev`. The `dev` buckets are emptied and deleted; `prod`
    keeps its buckets and table. If the Amazon Location key cannot be
    deleted because it was used recently, see the rotation section in [docs/SECURITY.md](docs/SECURITY.md).

Resources created by the stack: one DynamoDB table (two GSIs, PITR), two S3 buckets (data, site), a CloudFront
distribution with origin access control and a security-headers policy, an API Gateway REST API with stage `dev` or
`prod` and access logs, three application Lambdas (Node.js 22, arm64) plus CDK helper Lambdas, IAM roles per
function, and one Amazon Location API key (`heritagetrail-<env>`). Amazon Location V2 needs no map, place index or
route calculator resources.

The stack does not set the account-level API Gateway CloudWatch role (`cloudWatchRole: false`), so it leaves a role
that another stack owns untouched. API access logs need that role to exist in the region. Check it with
`aws apigateway get-account --region us-east-1`. If `cloudwatchRoleArn` is empty, set a role with the
`AmazonAPIGatewayPushToCloudWatchLogs` policy before deploying, or set `cloudWatchRole: true` in
`infra/lib/constructs/api.ts`.

## Dataset sources and attribution

| Source | Publisher | Used for | Licence | Attribution |
|---|---|---|---|---|
| [Wikidata Query Service](https://query.wikidata.org/) | Wikimedia Foundation / Wikidata community | Names, coordinates, districts, designations, ASI Monument IDs (P1371), UNESCO WHS IDs (P757), inception (P571), descriptions, image file names | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Wikidata (structured data, CC0 1.0) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via the [Overpass API](https://overpass-api.de/api/interpreter) | OpenStreetMap Foundation and contributors | Forts, temples, monuments, museums, archaeological sites; coordinate cross-check | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © OpenStreetMap contributors |
| [Wikimedia Commons API](https://commons.wikimedia.org/w/api.php) | Wikimedia Foundation; each file's author | Image URLs, licence, author, credit (images are linked, not copied) | Per file (CC BY, CC BY-SA, CC0, public domain) | Shown per image |
| [geoBoundaries gbOpen IND ADM1](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/) | geoBoundaries (William & Mary geoLab); DataMeet India community | State and union territory boundaries, state validation | CC BY ([2.5 IN](https://creativecommons.org/licenses/by/2.5/in/) per metadata, 4.0 per DataMeet README) | geoBoundaries (gbOpen IND ADM1), source: DataMeet India community |
| [geoBoundaries gbOpen IND ADM2](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/) | geoBoundaries; Pathways Data Pvt. Ltd., lgdirectory.gov.in | District boundaries, district derivation and density | ODbL 1.0 (per geoBoundaries metadata; upstream source unreachable, **unverified**) | geoBoundaries (gbOpen IND ADM2), source: Pathways Data Pvt. Ltd., lgdirectory.gov.in |
| Amazon Location Service | AWS and its data providers | Basemap tiles, place search, routing (deployed mode) | AWS service terms | Shown by the map's attribution control from the style |

The app shows these attributions in its attribution panel, built from each GeoJSON file's `metadata.attribution`.

Checked and **not ingested** (reasons in [docs/DATASETS.md](docs/DATASETS.md)):

- **UNESCO World Heritage Centre:** republication needs prior written authorization. Records only link to
  `https://whc.unesco.org/en/list/<id>` using the WHS ID from Wikidata.
- **Archaeological Survey of India:** the monument list PDF has no coordinates and may not be reproduced without
  permission. Only the published Tamil Nadu total (412 centrally protected monuments) is used, for the coverage
  figure below.
- **ISRO Bhuvan:** terms forbid redistribution and bulk extraction of coordinates.
- **AWS Registry of Open Data:** no India heritage dataset is listed; OSM and Overture there are planet-scale files
  kept as a future option.

The processed site data is offered under ODbL 1.0; see [data/LICENSE-DATA.md](data/LICENSE-DATA.md).

## Data quality notes (Tamil Nadu)

From `data/processed/tamil-nadu.report.json`:

- 629 published sites: 365 verified, 264 unverified; 1 rejected (Western Ghats, its point lies in Kerala). By
  category: temple 186, fort 44, monument 117, museum 85, archaeological site 102, other 95. UNESCO: 2 inscribed
  items, 12 components, 1 tentative.
- **Historical period is sparse:** 603 sites have no period (Wikidata inception is rarely set). The period filter
  therefore mostly shows "unknown".
- **Descriptions** are short Wikidata descriptions (CC0) and 454 sites have none. No long-form history text from an
  open source was verified, so none is shown.
- **Images:** 221 Commons images, all with resolved licence and author; 408 sites have no image.
- **ASI coverage gap:** the records carry 263 distinct centrally protected ASI IDs out of the 412 ASI lists for
  Tamil Nadu, so 149 centrally protected monuments are not yet in the open data.
- **District boundaries:** in geoBoundaries ADM2 the names of Kancheepuram and Chengalputtu appear swapped. Records
  keep the Wikidata district (75 district mismatches are flagged, 63 of them this swap), and district density for
  those two districts pairs counts with the other polygon's area. The app shows this note.
- 84 records carry a possible-duplicate flag (42 pairs not merged), and 6 have a coordinate conflict between
  Wikidata and OSM (for example Sankagiri Fort, 49 km apart). Records with a coordinate conflict are always
  `unverified`, even when they have an ASI or WHS ID. Check flagged records before relying on them.

## Licence

The source code is released under the [MIT licence](LICENSE). The MIT licence covers code only; the data under
`data/` keeps its own licences ([data/LICENSE-DATA.md](data/LICENSE-DATA.md)).

How this was decided: `npm run license:audit` (based on `npm ls --omit=dev --all`) on 2026-10-30 found 180
third-party production packages: MIT 90, Apache-2.0 53, ISC 23, BSD-3-Clause 4, BSD-2-Clause 2, OFL-1.1 2,
0BSD 1, Unlicense 1, BlueOak-1.0.0 1, `(MIT OR Apache-2.0)` 1, `MIT AND ISC AND BSD-3-Clause` 1 and
`(MIT OR GPL-3.0-or-later)` 1 (the `case` package, used here under its MIT option). No package is copyleft-only or
unlicensed. The two OFL-1.1 packages are the web fonts `@fontsource/inter` and `@fontsource/cormorant-garamond`; the
SIL Open Font License allows bundling the fonts with software under any licence, and the font files stay under OFL.
The data licences (CC0, ODbL, CC BY, per-file Commons licences) apply to the data files and do not restrict the
licence of the code. (The `license-checker-rseidelin` package named in the plan does not exist on npm, and
`license-checker` only sees the private root package in an npm workspaces repo, so the audit uses `npm ls`.)
