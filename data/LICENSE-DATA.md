# Data licences

The MIT licence in the repository root covers source code only. Everything under `data/` keeps the licences below.
Evidence for every licence statement is in [docs/DATASETS.md](../docs/DATASETS.md) (checked 2026-10-30).

## Processed site GeoJSON (`data/processed/<state>.geojson`, `index.json`, `<state>.report.json`)

The processed site files form one database that combines Wikidata and OpenStreetMap records.
Because it contains OSM-derived records, **the database is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)**.
The same statement is stored in each file's `metadata.databaseLicense` and `metadata.attribution`.

- Attribution required: **"© OpenStreetMap contributors"**, and make clear the data is under ODbL
  (https://www.openstreetmap.org/copyright).
- If you publish a database derived from these files, you must offer it under ODbL 1.0.
- Wikidata content (names, coordinates, districts, designations, ASI Monument IDs, UNESCO WHS IDs, inception dates,
  descriptions) is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) and is compatible with ODbL.
- Every record keeps its own provenance in `sources[]` (source name, source ID, URL, licence, licence URL, retrieval
  time) and a per-record `license` field: `CC0-1.0` for Wikidata-only records (332 in Tamil Nadu), `ODbL-1.0` when an OSM source is
  part of the record (297).

## Raw source responses (`data/raw/<state>/`)

Unmodified copies of the responses the pipeline fetched, kept for provenance and offline re-runs.

| Files | Source | Licence |
|---|---|---|
| Wikidata SPARQL results | https://query.wikidata.org/sparql | CC0 1.0 |
| Overpass API results | https://overpass-api.de/api/interpreter | ODbL 1.0, © OpenStreetMap contributors |
| Commons `imageinfo` results | https://commons.wikimedia.org/w/api.php | Metadata about files; each file's licence is stated in the response |

## Boundaries (`data/processed/boundaries/`)

| File | Source | Licence | Attribution |
|---|---|---|---|
| `india-states.geojson`, `<state>-state.geojson` | [geoBoundaries gbOpen IND ADM1](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/) | CC BY: [CC BY 2.5 IN](https://creativecommons.org/licenses/by/2.5/in/) per geoBoundaries metadata; the upstream [DataMeet maps README](https://raw.githubusercontent.com/datameet/maps/master/README.md) states [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | geoBoundaries (gbOpen IND ADM1), source: DataMeet India community |
| `<state>-districts.geojson` | [geoBoundaries gbOpen IND ADM2](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) per geoBoundaries metadata | geoBoundaries (gbOpen IND ADM2), source: Pathways Data Pvt. Ltd., lgdirectory.gov.in |

The ADM2 upstream licence source (`geonode.pathwaysdata.com`) could not be reached (DNS failure on 2026-10-30), so
the ODbL statement is confirmed only by geoBoundaries metadata (**upstream unverified**). The pipeline simplifies and
truncates the boundary geometries; the files are reference layers, not an authoritative depiction of India's borders.

## Images

No image files are stored in this repository. Records link to Wikimedia Commons files (`image.url`, `image.thumbUrl`,
`image.filePageUrl`). Each image keeps its own licence, recorded per record as `image.license`, `image.licenseUrl`,
`image.artist` and `image.credit`, taken from the Commons API. Images whose licence or author could not be resolved
are dropped. Show the licence and author wherever an image is displayed.

## Not included

- **UNESCO World Heritage Centre**: no UNESCO coordinates, descriptions or images are included. UNESCO's terms require
  prior written authorization for republication. Records only carry the WHS ID (from Wikidata P757) and a link to
  `https://whc.unesco.org/en/list/<id>`.
- **Archaeological Survey of India**: no ASI list content is included (reproduction needs ASI permission). Only the
  published Tamil Nadu total (412 centrally protected monuments, ASI `CPM_List.pdf`, 2025-04-08) is used, as a count
  for the coverage report. ASI Monument IDs come from Wikidata P1371 (CC0).
- **ISRO Bhuvan**: not used. Its terms forbid redistribution and bulk extraction of coordinates.
