# HeritageTrail India: Dataset Research (Phase 1)

All checks below were made on **2026-10-30 (IST)** from this machine with `curl` or a web fetch.
Each entry lists the exact URL that was fetched and what the response showed.
Anything not confirmed from the source itself is marked **unverified**.
Nothing here is legal advice; licence summaries quote or paraphrase the source's own terms page.

## Summary: what the pipeline should use

| Role | Source | Licence (as stated by source) | Use in pipeline |
|---|---|---|---|
| Primary site records (Tamil Nadu and other states) | Wikidata Query Service (SPARQL) | CC0 1.0 (structured data) | **Use.** Names, coordinates, district, heritage designation, ASI Monument ID, UNESCO WHS ID, inception date, image file name, description |
| Secondary site records and cross-check | OpenStreetMap via Overpass API (Geofabrik extracts for bulk) | ODbL 1.0 | **Use.** `historic=*`, `tourism=museum`, forts, temples tagged `historic`; fill gaps and cross-check Wikidata coordinates |
| Images and image licences | Wikimedia Commons MediaWiki API (`prop=imageinfo`, `extmetadata`) | Per file (CC BY, CC BY-SA, PD, etc.) | **Use.** Only show an image when the per-file licence and author were resolved from the API |
| State boundaries | geoBoundaries gbOpen IND ADM1 | CC BY (see notes: CC BY 2.5 IN per geoBoundaries metadata) | **Use**, with attribution to geoBoundaries and DataMeet |
| District boundaries | geoBoundaries gbOpen IND ADM2 | ODbL 1.0 (per geoBoundaries metadata; upstream source unreachable) | **Use**, flagged: upstream licence page could not be reached |
| Completeness cross-check only | ASI "List of Centrally Protected Monuments/Sites" PDF | All rights reserved (ASI copyright policy) | **Do not ingest or republish.** Use only the published per-state counts to report coverage gaps |
| UNESCO status | UNESCO WHC list XML/XLS feed | Republication requires prior written authorization | **Do not ingest.** Take WHS status and WHS ID from Wikidata and link to the official `whc.unesco.org/en/list/<id>` page |
| Not used | ISRO Bhuvan | Terms forbid redistribution and bulk coordinate extraction | **Do not use** |
| Not used for v1 | AWS Registry of Open Data (OSM on AWS, Daylight, Overture Maps) | ODbL / CDLA Permissive 2.0 | Available, but planet-scale PBF/GeoParquet; no India heritage dataset found. Future option |

Licence consequence for later phases: OSM-derived records are ODbL. If they are merged into the processed GeoJSON, that combined database must be offered under ODbL 1.0 with OSM attribution. Wikidata (CC0) and geoBoundaries ADM2 (ODbL) are compatible with that. The application code licence is a separate decision (Phase 7).

---

## 1. Wikidata (CC0), via the Wikidata Query Service

- **Publisher:** Wikimedia Foundation / Wikidata community
- **Official URLs:** https://www.wikidata.org/ ; SPARQL endpoint https://query.wikidata.org/sparql
- **How verified (2026-10-30):**
  - Fetched https://www.wikidata.org/wiki/Wikidata:Licensing. It states that all structured data in the main, Property, Lexeme and EntitySchema namespaces is released under Creative Commons Zero; text in other namespaces is CC BY-SA 4.0.
  - Fetched https://www.wikidata.org/wiki/Property:P1371. P1371 is "ASI Monument ID", an identifier assigned to monuments catalogued by the Archaeological Survey of India, format `[NS]-[A-Z]{2}-...` (for example `N-TN-C202`).
  - Fetched https://www.wikidata.org/wiki/Special:EntityData/P757.json. P757 is "World Heritage Site ID".
  - POSTed a SPARQL query to https://query.wikidata.org/sparql (HTTP 200, `application/sparql-results+json`) for items with P1371 (ASI Monument ID), located in Tamil Nadu (`wdt:P131* wd:Q1445`), with coordinates (P625), plus optional district (P131 that is a district of India, Q1149652), image (P18), inception (P571) and heritage designation (P1435). Results:
    - 356 distinct items with coordinates; 263 distinct `N-` (centrally protected) IDs and 80 distinct `S-` (state protected) IDs.
    - 349 items have a district; 200 items have an image; only 14 result rows have an inception date.
    - Heritage designation labels seen: Monument of National Importance (305 rows), State Protected Monument (86), World Heritage Site (1), part of UNESCO World Heritage Site (4), Tentative World Heritage Site (1).
    - Sample row: "Delhi Gate", `N-TN-C213`, `Point(79.3378 12.9075)`, Ranipet district, image `Delhi gate - river side view.jpg`.
  - A count query for items with `P31 wd:Q33506` (museum), in Tamil Nadu, with coordinates returned 17.
  - A query for items in Tamil Nadu with P757 (World Heritage Site ID) returned 15 rows, for example Prahadisvarar Temple (`250-001`), Airavatesvara Temple (`250bis-003`), Gangaikonda Cholapuram (`250bis-002`), Mukunda Nayanar Temple (`249-002`), Nilgiri Mountain Railway (`944ter-002`) and several Western Ghats components (`1342rev-...`).
  - A combined museum + WHS count query timed out (HTTP 504). Heavy queries must be split.
- **Geographic fields:** `P625` coordinate (WKT `Point(lon lat)`), `P131` located in administrative entity (district, state), `P17` country.
- **Other fields useful for the schema:** label (name), description (`schema:description`, CC0), `P31` instance of (category), `P1435` heritage designation, `P1371` ASI Monument ID, `P757` UNESCO WHS ID, `P571` inception (sparse), `P18` image (Commons file name), sitelinks to Wikipedia.
- **Licence:** CC0 1.0 for structured data. Wikipedia article text is **not** CC0 (CC BY-SA); the pipeline should use Wikidata descriptions only, not Wikipedia extracts.
- **Access:** public SPARQL endpoint, JSON results; no key. Send an identifying User-Agent. Queries over large hierarchies can time out.
- **Format:** SPARQL JSON (also CSV/TSV/XML).
- **Limitations:** community-edited, so coordinates must be validated against the state polygon. Historical period is sparse (14 rows with inception). UNESCO coverage is partial: the Mahabalipuram group item itself and Gingee Fort (part of "Maratha Military Landscapes of India", 2025) were not returned by the P757 query. Some items lack a district.

## 2. OpenStreetMap (ODbL)

- **Publisher:** OpenStreetMap Foundation and contributors
- **Official URLs:** https://www.openstreetmap.org/ ; licence page https://www.openstreetmap.org/copyright
- **How verified (2026-10-30):**
  - Fetched https://www.openstreetmap.org/copyright. OSM data is licensed under the Open Data Commons Open Database License (ODbL). Users must credit "OpenStreetMap contributors" and make clear the data is under ODbL; if you alter or build upon the data, you may distribute the result only under the same licence.
  - Fetched https://wiki.openstreetmap.org/wiki/Overpass_API. Main instance endpoint is `https://overpass-api.de/api/interpreter`. Usage guidance: under 10,000 queries and 1 GB per day for one-off use, divide by 100 for regular use; identify your app with a User-Agent; back off 30 s on 429/406; commercial use should self-host or pay; the server is described as overloaded.
  - POSTed Overpass QL to https://overpass-api.de/api/interpreter for `historic=fort` and `historic=castle` inside `area["ISO3166-2"="IN-TN"]`. First attempt: HTTP 502 ("server is currently at capacity"). Retry: HTTP 200, JSON, 46 elements, `osm3s.copyright` = "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL." Samples: `node/1669711997` Thirumayam Fort 10.2475835, 78.7514866 (`wikidata=Q7785352`); `node/2154074908` Gingee Fort: Rajagiri Fort 12.2495903, 79.3993434 (`wikidata=Q3536493`); `node/7689382152` Sankagiri Fort 11.4792256, 77.8639376.
  - An alternate instance, https://overpass.private.coffee/api/interpreter, timed out after 180 s (no data).
  - A count query inside Tamil Nadu (HTTP 200, OSM base 2026-10-30T07:18:58Z) returned: any `historic=*` 623; any `heritage=*` 17; `heritage:operator=asi` 0; `tourism=museum` 85; `amenity=place_of_worship` with `historic=*` 31; `historic=*` with `wikidata=*` 64.
  - Fetched https://download.geofabrik.de/asia/india.html and https://download.geofabrik.de/asia/india/southern-zone.html. India `.osm.pbf` is 1.6 GB (data up to 2026-10-28T21:21:02Z); Southern Zone `.osm.pbf` 532 MB, `-free.shp.zip` and `-free.gpkg.zip` 1.2 GB each. Geofabrik notes that its public files omit user names, user IDs and changeset IDs. Which states are inside "Southern Zone" is not listed on the page (**unverified**).
- **Geographic fields:** node `lat`/`lon`; ways/relations via `out center` give `center.lat`/`center.lon`. Optional tags `addr:district`, `addr:state` are not guaranteed (state/district must be derived from boundaries).
- **Other fields:** `name`, `name:en`, `name:ta`, `historic`, `tourism`, `amenity`, `religion`, `heritage`, `wikidata`, `wikipedia`, `start_date` (when present).
- **Licence:** ODbL 1.0, attribution "© OpenStreetMap contributors", share-alike for derived databases.
- **Access:** Overpass API (JSON/XML, no key, rate-limited, unreliable under load); Geofabrik extracts (PBF, shapefile, GeoPackage).
- **Limitations:** `heritage:operator=asi` is not used in Tamil Nadu (0 results), so OSM alone cannot say whether a site is ASI-protected. Many `historic=*` features are minor (memorials, boundary stones) and need category filtering. The pipeline must cache responses and retry with backoff.

## 3. Wikimedia Commons (images and image licences)

- **Publisher:** Wikimedia Foundation; each file is owned by its creator
- **Official URLs:** https://commons.wikimedia.org/ ; API https://commons.wikimedia.org/w/api.php
- **How verified (2026-10-30):**
  - Fetched https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia. Almost all media is under a free licence (usually CC BY, CC BY-SA, GFDL) or public domain, each file's licence is on its description page, and the reuser must verify the licence of each file. The page recommends against hotlinking.
  - Fetched `https://commons.wikimedia.org/w/api.php?action=query&titles=File:Delhi%20gate%20-%20river%20side%20view.jpg&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|Credit&format=json` (HTTP 200). Returned `LicenseShortName` "CC BY-SA 3.0", `LicenseUrl` https://creativecommons.org/licenses/by-sa/3.0, `Artist` (a Commons user name), `Credit` "Own work".
- **Fields:** image URL, licence short name, licence URL, artist, credit.
- **Licence:** per file. The pipeline must store licence name, licence URL, author and file page URL with every image, and drop images whose licence cannot be resolved.
- **Access:** MediaWiki API, JSON, no key.
- **Note:** `Artist` is a public attribution string that the licence requires. It is the only person-related field the pipeline should keep, and only for attribution.

## 4. UNESCO World Heritage Centre

- **Publisher:** UNESCO World Heritage Centre
- **Official URL:** https://whc.unesco.org/
- **How verified (2026-10-30):**
  - Fetched https://whc.unesco.org/en/syndication/. Terms: republication of any UNESCO/WHC data online or in any other form requires prior written authorization; permission may be requested for personal, non-commercial use; no modification of content; each use must link back and carry "Copyright © 1992 - [current year] UNESCO/World Heritage Centre. All rights reserved."
  - Fetched https://whc.unesco.org/en/list/xml/ (HTTP 200, `text/xml`, 2,501,664 bytes). 1,273 rows, 216 columns. Fields include `id_number`, `site`, `states`, `iso_code`, `category`, `date_inscribed`, `short_description` (HTML), `image_url`, `http_url`, `geolocations/poi` (latitude, longitude, iso2). 45 rows list India. Tamil Nadu examples: 249 Group of Monuments at Mahabalipuram (3 POIs, first 12.6175, 80.19889); 250 Great Living Chola Temples (3 POIs, first 10.783861, 79.131583); 944 Mountain Railways of India; 1342 Western Ghats; 1739 Maratha Military Landscapes of India (12 POIs, first 12.2505556, 79.4013889).
  - Fetched https://whc.unesco.org/en/list/xls/ (HTTP 200, XLSX, 2,942,592 bytes) and https://whc.unesco.org/en/list/kml/ (HTTP 200, a KML NetworkLink pointing to https://whc.unesco.org/en/list/kmz; the KMZ itself was not downloaded).
  - Fetched https://whc.unesco.org/en/statesparties/in (HTTP 200, HTML).
- **Geographic fields:** per-component latitude/longitude, ISO country codes. No Indian state or district field.
- **Licence:** all rights reserved; republication requires prior written authorization.
- **Access:** XML, XLSX, KML/KMZ feeds, HTML pages; no key.
- **Decision:** do **not** ingest UNESCO coordinates, descriptions or images. Use Wikidata's P1435/P757 to mark WHS status and link each record to `https://whc.unesco.org/en/list/<id_number>`. Asking UNESCO for written permission is an option for a later release.

## 5. Archaeological Survey of India (ASI)

- **Publisher:** Archaeological Survey of India, Ministry of Culture, Government of India
- **Official URL:** https://asi.nic.in/
- **How verified (2026-10-30):**
  - Fetched https://asi.nic.in/ (HTTP 200, an 8.3 MB single-page app). Paths such as `/alphabetical-list-of-monuments/` return the same home page, so they are not real list pages.
  - Fetched https://asi.nic.in/pages/Copyright-Policy/ (HTTP 200). It states that the website contents may not be reproduced partially or fully without due permission from ASI, and that the source must be acknowledged if referred to.
  - Fetched https://asi.nic.in/pages/Monuments (HTTP 200). It links "Centrally Protected Monument's List" to `/pdf/CPM_List.pdf`.
  - Downloaded https://asi.nic.in/pdf/CPM_List.pdf (HTTP 200, `application/pdf`, 3,283,232 bytes, 142 pages, title "List of Centrally Protected Monuments/Sites", created 2025-04-08). Columns: Sl.No., Name of the Monument/Site, Locality, District. The summary table lists Tamilnadu: 412 monuments (Chennai Circle 250, Tiruchirapalli Circle 162) and Puducherry (U.T.): 7. No latitude or longitude appears anywhere in the extracted text.
  - Fetched https://asi.nic.in/pages/HQ/monument/: HTTP 500 JSON error.
- **Geographic fields:** locality and district text only. **No coordinates.**
- **Licence:** reproduction requires ASI permission. Not an open licence.
- **Access:** PDF download; no API found.
- **Decision:** not ingested and not republished. The pipeline may use the published per-state totals (for example 412 for Tamil Nadu) to report how many centrally protected monuments are still missing from the open-data records. Wikidata's P1371 ASI Monument ID gives the link to ASI's numbering without copying the PDF.

## 6. ISRO Bhuvan

- **Publisher:** National Remote Sensing Centre (NRSC), ISRO, Department of Space
- **Official URL:** https://bhuvan.nrsc.gov.in/
- **How verified (2026-10-30):**
  - Fetched https://bhuvan.nrsc.gov.in/ (HTTP 200, redirects to `/ngmaps`, a JavaScript map viewer).
  - Fetched https://bhuvan.nrsc.gov.in/home/index.php (HTTP 200). "Latest Updates" lists "Bharat Darshan - Visualize UNESCO Heritage Sites in India" and "KASTURI - Knowledgebase of Archaeology and heritage using Spatial Technologies: a Unified Resource for India", but neither item has a link in the page HTML. No download or API for them was found (**unverified** whether one exists).
  - Read the "Bhuvan Terms of Service" in that page. Without prior written authorization users must not copy or make derivative works of the content, must not redistribute or publish it to third parties, and must not use the site for mass downloads or bulk feeds of content "including but not limited to numerical latitude or longitude coordinates".
  - Fetched https://bhuvan-app3.nrsc.gov.in/data/download/policy.php (HTTP 200). Data Dissemination Policy: single-user licence after registration, internal use, Internet hosting excluded, and copyright with NRSC/ISRO.
  - Fetched https://bhuvan-app1.nrsc.gov.in/api/ (HTTP 200). Lists APIs for village geocoding, LULC statistics, routing and geoid conversion behind login and access token; no heritage API listed.
  - Guessed paths https://bhuvan-app1.nrsc.gov.in/heritage/ and https://bhuvan-app1.nrsc.gov.in/culture/ returned HTTP 404.
- **Decision:** **not usable.** The terms forbid redistribution and bulk coordinate extraction, and no heritage dataset download was found.

## 7. AWS Registry of Open Data

- **Publisher:** Amazon Web Services (registry); each dataset has its own manager
- **Official URL:** https://registry.opendata.aws/
- **How verified (2026-10-30):**
  - Fetched https://registry.opendata.aws/ (HTTP 200, 2.3 MB, 1,222 dataset entries). Searched every entry for "India", "heritage", "monument" and "administrative boundary". India matched only "IGP Brick Kilns India"; "heritage" matched unrelated datasets (Software Heritage, Biodiversity Heritage Library, SUCHO Ukrainian web archives, Scottish LiDAR, ocean radar). **No India heritage-site dataset is listed.**
  - Fetched https://registry.opendata.aws/osm/ "OpenStreetMap on AWS". Licence link https://www.openstreetmap.org/copyright; managed by OSMF and Pacific Atlas; resources `arn:aws:s3:::osm-planet-eu-central-1`, `arn:aws:s3:::osm-planet-us-west-2` (planet/history PBF) and `arn:aws:s3:::osm-pds` (us-east-1). An anonymous listing of `https://osm-pds.s3.amazonaws.com/` returned `planet-latest.osm.pbf`, `history-latest.osm.pbf` and prefixes `planet/`, `planet-history/`, `changesets/`, `2026/`.
  - Fetched https://registry.opendata.aws/daylight-osm/ "Daylight Map Distribution of OpenStreetMap". Licence ODbL; quarterly; PBF in `daylight-map-distribution` (us-west-1) and Parquet in `daylight-openstreetmap` (us-west-2).
  - Fetched https://registry.opendata.aws/overture/ "Overture Maps Foundation Open Map Data". Licence CDLA Permissive v2, except OSM-derived data which is ODbL; monthly GeoParquet in `arn:aws:s3:::overturemaps-us-west-2/release/`. An anonymous listing returned releases `2026-09-23.0`, `2026-09-23.1`, `2026-10-21.0`, and themes addresses, base, buildings, divisions, places, transportation.
  - Fetched https://docs.overturemaps.org/attribution/. Places theme: data from Meta, Microsoft and others under CDLA Permissive 2.0, Foursquare under Apache 2.0, AllThePlaces under CC0. Divisions theme: ODbL (OSM), plus geoBoundaries CC BY 4.0 and others.
  - `https://registry.opendata.aws/geoboundaries/`, `/wikidata/`, `/wikipedia/`, `/india/`, `/fieldmaps/` returned HTTP 404.
- **Decision:** not used in v1. These are planet-scale files that need Parquet or PBF tooling, and the Overture Places content for Indian heritage sites was **not sampled (unverified)**. Overture Places is a candidate future source for museums.

## 8. India state and district boundaries (GeoJSON)

### geoBoundaries gbOpen IND ADM1 (states and union territories): **use**

- **Publisher:** geoBoundaries (William & Mary geoLab); boundary source DataMeet India community and Election Commission of India
- **How verified (2026-10-30):**
  - Fetched https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/ (HTTP 200 JSON). `boundaryLicense` "Creative Commons Attribution 2.5 India (CC BY 2.5 IN)", `licenseSource` github.com/datameet/maps, `boundarySource` "DataMeet India community, Election Commission of India", `admUnitCount` 36, `boundaryYearRepresented` 2011, `buildDate` Dec 12, 2023.
  - Downloaded the `simplifiedGeometryGeoJSON` URL (https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson, redirected to media.githubusercontent.com; HTTP 200, 5,103,747 bytes). 36 features with properties `shapeName`, `shapeISO`, `shapeID`, `shapeGroup`, `shapeType`. Names include "Tamil Nādu", "Telangāna", "Ladākh", "Dādra and Nagar Haveli and Damān and Diu", so the units are current despite the "2011" year field. Names carry diacritics and need normalising.
  - Fetched https://raw.githubusercontent.com/datameet/maps/master/README.md (HTTP 200). "Unless explicitly stated, all datasets in this repository is shared under CC BY 4.0", with a suggested attribution to the DataMeet India community. The repository LICENSE file (https://raw.githubusercontent.com/datameet/maps/master/LICENSE) is MIT, copyright 2020 DataMeet India community.
  - Fetched https://www.geoboundaries.org/. It describes geoBoundaries as CC BY 4.0 and requires acknowledgement.
- **Licence decision:** CC BY. geoBoundaries metadata says CC BY 2.5 IN and the DataMeet README says CC BY 4.0. Both only require attribution. Attribute "geoBoundaries (gbOpen IND ADM1), source: DataMeet India community" and link both licences.
- **Format:** GeoJSON (simplified and full), also shapefile and TopoJSON via geoBoundaries.

### geoBoundaries gbOpen IND ADM2 (districts): **use, flagged**

- **How verified (2026-10-30):**
  - Fetched https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/ (HTTP 200 JSON). `boundaryLicense` "Open Data Commons Open Database License 1.0", `boundarySource` "Pathways Data Pvt. Ltd., lgdirectory.gov.in", `licenseSource` geonode.pathwaysdata.com/layers/geonode, `admUnitCount` 736, `boundaryYearRepresented` 2021.
  - Downloaded the simplified GeoJSON (HTTP 200, 7,979,916 bytes): 735 features. A centroid-in-polygon test against the Tamil Nadu ADM1 polygon found 39 districts: all 38 Tamil Nadu districts, including newer ones (Chengalputtu, Kallakurichi, Mayiladuthurai, Ranipet, Tenkasi, Tirupathur), plus Puducherry (a centroid artefact of the simple test).
  - The upstream licence source `https://geonode.pathwaysdata.com/` could not be resolved (DNS failure), so the ODbL claim is confirmed only by geoBoundaries metadata (**upstream unverified**).
- **Licence decision:** use under ODbL 1.0 with attribution "geoBoundaries (gbOpen IND ADM2), source: Pathways Data Pvt. Ltd., lgdirectory.gov.in". Record the upstream as unverified in provenance. ODbL is the same licence as the OSM-derived data.

### Rejected or secondary boundary options

- DataMeet `Districts/Census_2011/2011_Dist.shp` and `docs/data/geojson/dists11.geojson` (listed via https://api.github.com/repos/datameet/maps/git/trees/master?recursive=1): 2011 census districts, missing districts created later, so not used.
- DataMeet `Country/india-soi.geojson` and `Country/india-osm.geojson` exist in the same tree (not downloaded). They are country outlines, not states.
- Caution (**unverified**): whether these boundaries match the Survey of India's official depiction of India's external boundary was not checked. The app should present boundaries as reference layers with attribution and not as an authoritative depiction.

## 9. Sources tried that were unreachable or had no usable data

| URL (fetched 2026-10-30) | Result |
|---|---|
| https://overpass.private.coffee/api/interpreter | Timed out after 180 s, no data |
| https://overpass-api.de/api/interpreter (first try) | HTTP 502, server at capacity; succeeded on retry |
| https://query.wikidata.org/sparql (combined museum + WHS count) | HTTP 504; split queries succeeded |
| https://asi.nic.in/pages/HQ/monument/ | HTTP 500 JSON error |
| https://asi.nic.in/alphabetical-list-of-monuments/ and similar guessed paths | Return the generic SPA home page, no list |
| https://bhuvan-app1.nrsc.gov.in/heritage/ , https://bhuvan-app1.nrsc.gov.in/culture/ | HTTP 404 |
| Bhuvan "Bharat Darshan" and "KASTURI" | Named on the home page without links; no download or API found |
| https://geonode.pathwaysdata.com/ | DNS resolution failed |
| https://registry.opendata.aws/geoboundaries/ , `/wikidata/` , `/wikipedia/` , `/india/` , `/fieldmaps/` | HTTP 404 (no such registry entries) |
| https://www.data.gov.in/search?title=protected%20monuments | HTTP 200, but results render client-side; not evaluated. Outside the brief's source list (**unverified**) |
| https://whc.unesco.org/en/list/kmz | Not downloaded (KML feed only points to it) |

## 10. Field coverage against the requested data

| Requested field | Source in pipeline | Coverage observed (Tamil Nadu) |
|---|---|---|
| Name | Wikidata label; OSM `name` | All records |
| Latitude/longitude | Wikidata P625; OSM node or way centre | All 356 Wikidata ASI-ID items; all 46 OSM fort/castle elements |
| State | Derived by point-in-polygon against geoBoundaries ADM1 | All, after validation |
| District | Wikidata P131 (district) and ADM2 point-in-polygon | 349 of 356 Wikidata items have P131 district; ADM2 fills or cross-checks |
| Category | Wikidata P31; OSM `historic`/`tourism`/`amenity` | Needs a mapping table (temple, fort, monument, museum, UNESCO) |
| Historical period | Wikidata P571 inception; OSM `start_date` | Sparse: 14 Wikidata rows with inception. Most records will be "unknown" |
| Description | Wikidata description (CC0) | Short, often absent; no long-form history from open sources was verified |
| Source reference | Wikidata item URL, OSM element URL, ASI Monument ID, UNESCO WHS ID | All records |
| Image + image licence | Wikidata P18 + Commons API extmetadata | 200 of 356 Wikidata items have P18; licence resolved per file |
| Heritage designation | Wikidata P1435 | 305 MNI rows, 86 state-protected rows, 5 WHS or part-of-WHS rows |
