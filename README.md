# Data Publishing Flows

A dashboard of how data moves through the platform: **Sources → Raw → Trusted → Refined**, split by
line of business (LOB), for each environment (Dev, UAT, Prod). It reads an export of pipeline
events from Splunk, or runs on built-in synthetic data until you load one.

Requires Node 22.13+ or 24 (see `.nvmrc`); the test and lint tooling will not run on Node 20.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## What you are looking at

- **Environment cards** select Dev, UAT or Prod and compare them side by side. Each environment is
  its own stack with its own Raw → Trusted → Refined. The arrows between the cards are *code*
  promotion: pipelines move Dev → UAT → Prod, but data does not. A card also counts the datasets
  that run there but have never run in Prod.
- **Stat tiles** show volume landed in Raw (with the change against the previous window of the same
  length), volume published to Refined, run success, and datasets whose latest run failed.
- **Data flow.** One lane per LOB. Node height is the bytes landed in that layer in the window, on
  one linear scale for the whole chart. A ribbon that narrows between columns shows the reduction
  from validation, deduplication, columnar compression and aggregation. Raw is retained, not used
  up, so this is drawn as tapering lanes rather than a Sankey that conserves flow. ▲ n marks failed
  runs landing in that layer. Click a LOB to break it into datasets (the 12 largest, with the rest
  folded into "Other").
- **Volume over time.** Bytes landed per hour (24-hour window) or per day, one panel per layer,
  each with its own scale. A faded last segment marks a bucket that is still filling.
- **Datasets.** The same numbers as a sortable table, including which environments each pipeline
  has reached and when its Refined output last updated.

Counting rules: volume counts **successful runs only**; failed runs are counted separately. Windows
end at the **newest event in the data** (not the wall clock), so an older export still shows its own
last N days. All buckets are **UTC**.

## Feeding it from Splunk

Use **Load Splunk export** in the header, or drop a file anywhere on the page. It accepts a Splunk
CSV export, a Splunk JSON export (one `{"result": {...}}` object per line), a REST
`{"results": [...]}` body, or a plain JSON array. Rows that fail validation are skipped and listed,
each with its row number and the reason. If a file has no usable rows, the current data stays loaded.
Files are read in the browser and never uploaded. Exports contain internal data, so keep them in
`exports/` (git-ignored) or outside the repo.

Each row is one pipeline hop that wrote data into a layer:

| Column       | Required | Values                                                                  |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `time`       | yes      | Epoch seconds or ms, or ISO-8601 **with an offset** (`Z`, `+00:00`, `-0500`). `_time` is accepted too. |
| `env`        | yes      | `dev`, `uat`, `prod` (case-insensitive)                                 |
| `lob`        | yes      | Any non-empty name                                                      |
| `dataset`    | yes      | Any non-empty name; unique within a LOB                                  |
| `from_layer` | yes      | `source` (ingestion from a system of record), `raw`, `trusted`          |
| `to_layer`   | yes      | `raw`, `trusted`, `refined`; must come after `from_layer`               |
| `status`     | yes      | `success` or `failed`                                                   |
| `bytes`      | yes      | Bytes written into `to_layer`, ≥ 0                                      |
| `records`    | no       | Rows written, ≥ 0 (default 0)                                           |
| `runs`       | no       | Runs folded into this row when Splunk pre-aggregates, ≥ 1 (default 1)   |

[`splunk/flow_events.spl`](splunk/flow_events.spl) is a search template that produces exactly these
columns. Fill in your index, sourcetype and field names. It normalises environment and status
values and pre-aggregates to hourly rows so that a 60-day export stays small. **Sample CSV** in the
header downloads two days of the synthetic data in this format.

The contract lives in [`src/data/model.ts`](src/data/model.ts). If your platform has different
layers (say, a separate landing zone), edit `LAYERS` there; the compiler then flags every per-layer
record that needs the new key.

## Background

- **Raw / Trusted / Refined** are the AWS data-lake layer names. Databricks calls the same idea
  bronze / silver / gold, the "medallion architecture". Raw is data as received, kept so it can be
  replayed. Trusted is validated, typed, deduplicated and conformed. Refined is modelled for a
  purpose: aggregates, reporting and data products.
  ([AWS prescriptive guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/defining-bucket-names-data-lakes/data-layer-definitions.html),
  [Databricks](https://docs.databricks.com/aws/en/lakehouse/medallion))
- JPMorgan Chase has described its enterprise data platform publicly as a **data mesh**. Data is
  organised into data products, each stored in its own product-specific lake and owned by people
  who understand it. Data is shared in place, not copied, and a mesh catalog that holds no data
  gives a single view of which lakes share data with which consumers.
  ([AWS Big Data Blog, May 2021](https://aws.amazon.com/blogs/big-data/how-jpmorgan-chase-built-a-data-mesh-architecture-to-drive-significant-value-to-enhance-their-enterprise-data-platform/)).
  This dashboard is that kind of flow visibility, built from pipeline logs. The post does not
  describe layer names or environments; those come from the general practice above.
- The sample LOBs follow the firm's public reporting segments: Consumer & Community Banking (CCB),
  Commercial & Investment Bank (CIB), Asset & Wealth Management (AWM) and Corporate. Every dataset
  name and volume in the sample is invented.

## Development

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Dev server with hot reload            |
| `npm test`          | Unit tests (parser and aggregations)  |
| `npm run typecheck` | TypeScript, strict                    |
| `npm run lint`      | ESLint (type-aware)                   |
| `npm run build`     | Typecheck, then production bundle in `dist/` |

React 19 + TypeScript + Vite. There are no charting dependencies: the diagrams are hand-built SVG.
Layout:

```
src/data/model.ts      the event contract (layers, environments, row shape)
src/data/parse.ts      Splunk CSV/JSON import and validation
src/data/aggregate.ts  windows, per-LOB/per-dataset flows, trends, summaries
src/data/sample.ts     synthetic history used until a file is loaded
src/components/        FlowDiagram, TrendPanels, EnvironmentCards, StatTiles, DatasetTable
```

The series and status colours come from a palette checked for colour-blind separation in light and
dark mode. LOBs take colours in alphabetical order, so a LOB keeps its colour whatever the filter.
LOBs past the eighth share a neutral grey and rely on their direct labels.

## Not built yet

- **Live Splunk connection.** Querying the Splunk REST API directly needs a small backend proxy to
  hold the token and avoid browser CORS limits. The parser already reads the REST `results` body, so
  the UI side would be a fetch that replaces the file load.
- **Size at rest.** This shows volume *written* per window. Storage footprint per layer would come
  from storage metrics (for example S3 Inventory or table statistics), not pipeline logs.
- **Consumers.** If the logs record reads from Refined by downstream applications, a fifth
  "Consumers" column would show the publish side of the mesh.
