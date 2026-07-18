# Backtest Data Export (ExportToFile Scheduler) — Test Case Plan

## Scope
Covers the `ScheduledServices/ExportToFile` service: a `node-cron`-driven daily job (`scheduler.js`) that reads a preferences collection to determine which MongoDB collections/symbols to export, then streams each to a JSON file on disk (`exportCollections.js`) for later consumption by the backtest replay pipeline (`BacktestStreamer`).

## Prerequisites
- MongoDB reachable with `BacktestApp` DB (`usersymbols`, `trades`, `ledgers`) and `stock_database` DB (per-symbol tick collections) populated
- `EXPORT_PREF_COLLECTION` populated with at least one preference document specifying `collectionName` and/or `symbolName`
- `EXPORT_VOLUME_PATH` and `EXPORT_CRON_SCHEDULE` configured; ability to trigger the export logic on-demand (bypassing cron) for testing, or manipulate system time / wait for the schedule

## Test Cases

### Scheduling & Preference Resolution

#### TC-EXP-001: Cron fires at the configured schedule in Asia/Kolkata timezone
- **Category**: Functional
- **Priority**: P1
- **Steps**: Verify `cron.schedule` is registered with `timezone:'Asia/Kolkata'` and the default `'15 16 * * *'` (4:15 PM IST) expression when `EXPORT_CRON_SCHEDULE` is unset
- **Expected Result**: Job fires at 16:15 IST regardless of the host container's local timezone.

#### TC-EXP-002: `getCollectionsToExport` merges both `collectionName` and `symbolName` fields from preference documents, deduplicated
- **Category**: Functional
- **Priority**: P1
- **Steps**: Seed `EXPORT_PREF_COLLECTION` with docs `{collectionName:"trades"}`, `{symbolName:"RELIANCE"}`, `{collectionName:"trades", symbolName:"RELIANCE"}` (duplicate)
- **Expected Result**: Resulting export list is `["trades","RELIANCE"]` (via `Set` dedup) — no duplicate export work for the same name appearing twice.

#### TC-EXP-003: `usersymbols` is ALWAYS exported, even if absent from preferences
- **Category**: Functional
- **Priority**: P1
- **Steps**: Seed preferences with unrelated collections only (no `usersymbols` entry); run export
- **Expected Result**: `exportAll` unconditionally adds `'usersymbols'` to the final list via `[...new Set([...collections, 'usersymbols'])]`.

#### TC-EXP-004: Preference documents with neither `collectionName` nor `symbolName` are silently skipped
- **Category**: Negative
- **Priority**: P2
- **Steps**: Seed a preference doc `{}` (no relevant fields)
- **Expected Result**: Contributes nothing to the export list; no crash from `undefined` entries (the `.filter(Boolean)` guards against this).

#### TC-EXP-005: MongoDB connection failure while fetching preferences degrades gracefully to an empty preference list (export continues with just `usersymbols`)
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate Mongo unavailability during `getCollectionsToExport`
- **Expected Result**: Caught in `scheduler.js`'s own try/catch around `getCollectionsToExport()`, logs the error, `collections=[]`; `exportAll` proceeds to export only `usersymbols` — verify this ALSO fails gracefully (per TC-EXP-005b) rather than crashing the whole cron job.

#### TC-EXP-005b: Total Mongo outage causes every individual `exportCollection` call to fail independently without crashing the scheduler
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate full Mongo unavailability for the entire `exportAll` run
- **Expected Result**: Each `exportCollection(coll)` promise rejects and is caught individually inside `Promise.all`'s per-item try/catch in `exportAll` — one failing export does not abort the others (they run concurrently via `Promise.all`); the cron job completes (with all exports failed/logged) and will retry naturally at the next scheduled run.

### Collection Export Logic — Special-Cased Collections

#### TC-EXP-006: `usersymbols` export filters to `is_active:true`, deduplicates by `instrument_token`, and strips `_id`/`user_id`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Seed `usersymbols` with active and inactive docs, and duplicate `instrument_token`s across different users
- **Expected Result**: Exported `usersymbols.json` contains only active symbols, one entry per unique `instrument_token` (first-seen wins), with `_id` and `user_id` fields removed from each object — confirms no per-user data or Mongo internal IDs leak into the exported file.

#### TC-EXP-007: For each active symbol, the corresponding `stock_database` collection is exported for the IST trading window (09:00–15:40)
- **Category**: Functional
- **Priority**: P0
- **Steps**: Seed a `stock_database.<SYMBOL>` collection with ticks both inside and outside 09:00-15:40 IST for "today"
- **Expected Result**: Only in-window ticks appear in `<SYMBOL>.json`; the query range is computed from `todayIST` (server's current date at run time), not from any caller-specified date — confirms the exporter always exports "today's" session only, with no way to backfill a historical date via this mechanism (matches how `BacktestStreamer`/`BacktestClient` are consumed for same-day or manually-seeded historical data only).

#### TC-EXP-008: A symbol in `usersymbols` with no matching `stock_database` collection is skipped with a logged error, not a fatal crash
- **Category**: Negative
- **Priority**: P1
- **Steps**: Include an active symbol whose ticker collection doesn't exist in `stock_database`
- **Expected Result**: The per-symbol `try/catch` inside the `usersymbols` branch catches the error, logs `Error exporting active symbol collection ...`, and continues to the next symbol — the overall `usersymbols` export (metadata file) still completes.

#### TC-EXP-009: `trades` and `ledgers` are correctly routed to the `BacktestApp` DB with their respective time fields (`created_at` / `created_on`)
- **Category**: Functional
- **Priority**: P0
- **Steps**: Trigger export with `trades` and `ledgers` in the preference list
- **Expected Result**: `trades.json` filters on `created_at` within TODAY (full IST calendar day, `startOf('day')`–`endOf('day')`, NOT the 09:00-15:40 trading window used for stock ticks); `ledgers.json` filters on `created_on` similarly; both read from the `BacktestApp` database.

#### TC-EXP-010: A generic collection name containing `:` or `|` is inferred to be a `stock_database` collection
- **Category**: Functional
- **Priority**: P1
- **Steps**: Preference doc with `collectionName: "NSE:RELIANCE"` (a colon-containing instrument-style name)
- **Expected Result**: `targetDbName` set to `stock_database`, `timeField:'timestamp'`, trading-window query applied — confirms the heuristic correctly special-cases instrument-key-style names without needing an explicit `symbolName` field.

#### TC-EXP-011: A generic collection name with no special characters is probed against `stock_database` via `listCollections` before falling back to the default DB
- **Category**: Functional
- **Priority**: P1
- **Steps**: Preference doc with `collectionName: "customCollection"` that exists ONLY in the default `dbName` DB (not in `stock_database`)
- **Expected Result**: `listCollections({name:'customCollection'})` against `stock_database` returns empty; `targetDbName` stays as the default `dbName`; export proceeds against the default DB with `timeField:'timestamp'` and the DEFAULT (full-day) date range logic path — verify this correctly falls through rather than erroring when the probe finds nothing.

#### TC-EXP-012: Collection/symbol names are sanitized before being used as output filenames
- **Category**: Security
- **Priority**: P1
- **Steps**: A symbol name or collection name containing path-traversal-style characters (e.g., `../../etc`) somehow reaches `exportCollection` (e.g., via a maliciously seeded preferences document, or a compromised `usersymbols` entry with special characters in `symbol`)
- **Expected Result**: `sanitizedCollectionName`/`sanitizedSymName` strip all characters outside `[a-zA-Z0-9-_]` before constructing the output file path — no path traversal possible via the OUTPUT filename construction, even though the input query itself (which collection/DB to read from) is not similarly hardened against unexpected names causing unintended reads (lower severity since preferences are admin/internal-seeded, not end-user input).

### Streaming Write Mechanics

#### TC-EXP-013: Large collections are streamed to disk via cursor iteration, not buffered fully in memory
- **Category**: Performance
- **Priority**: P1
- **Steps**: Export a collection with a very large number of documents (simulate with a large seeded dataset)
- **Expected Result**: `for await (const doc of cursor)` + incremental `writeStream.write` confirms O(1) memory usage relative to collection size (aside from one document at a time plus stream buffering) — no `.toArray()` on the main export path (contrast with the `usersymbols` special case, which DOES call `.toArray()` on the preference-filtered result, acceptable since that collection is expected to be small).

#### TC-EXP-014: Output JSON is a syntactically valid array even for zero-document exports
- **Category**: Negative
- **Priority**: P1
- **Steps**: Export a collection/date range with zero matching documents
- **Expected Result**: Output file contains exactly `[]` (opening bracket, no comma-separated entries since `isFirst` never flips, closing bracket) — valid, parseable empty-array JSON, not `[,]` or truncated content.

#### TC-EXP-015: Write stream errors (e.g., disk full, permissions) are caught and reported per-collection without crashing the whole export run
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate a filesystem write error (e.g., read-only mount, disk quota) during one collection's export
- **Expected Result**: The `writeStream.on('error', reject)` rejects the wrapping promise, which propagates up to `exportCollection`'s own outer catch, logging `Error exporting <name>: <message>` — other collections in the same `exportAll` batch (run via `Promise.all`) are unaffected.

#### TC-EXP-016: `MongoClient` connection is always closed via `finally`, even on error paths
- **Category**: Regression
- **Priority**: P2
- **Steps**: Force an error partway through `exportCollection` (e.g., bad query, write failure)
- **Expected Result**: `client.close()` in the `finally` block executes regardless of success/failure — confirms no leaked MongoDB connections accumulate across the many collections exported per run (potentially dozens of `MongoClient` instances created and torn down per `exportAll` invocation, since each `exportCollection` call makes its own connection rather than sharing one).

### Volume / Path Configuration (Critical Regression)

#### TC-EXP-017: Export path is `<EXPORT_VOLUME_PATH>/<YYYY-MM-DD>/...` with NO `exportedData` subfolder
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #53
- **Steps**: Set `EXPORT_VOLUME_PATH=/exported_stock_data` (matching the compose volume mount for `exporttofile`); trigger an export; inspect the actual file paths written
- **Expected Result** (current bug): Files land at `/exported_stock_data/<date>/<name>.json` — there is NO `exportedData/` subfolder in this path, whereas `BacktestStreamer`'s `streamer.js` reads from `path.join(SHARED_DIR, 'exportedData', date, ...)`. Even if the two services shared the same underlying volume (which per issue #53 they currently do NOT — see below), the path shapes would still mismatch by this missing subfolder segment.

#### TC-EXP-018: `exporttofile` and the backtest-reading services (`BacktestStreamer`) are mounted on entirely different, unconnected Docker volumes
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #53
- **Steps**: Inspect `docker-compose.yml` volume declarations and mounts for `exporttofile` (volume `exported_stock_data`) vs. `backteststreamer` (volume `backtest-data`, mounted at `/shared`)
- **Expected Result** (current bug): Confirmed two distinct named volumes with no common mount point between the writer and any reader service — data exported by this scheduled job is physically unreachable by the backtest replay pipeline under the current compose configuration, making the daily export functionally useless for its apparent intended purpose. An orphaned `shared-space:` volume is declared in the compose file but mounted on zero services.
- **Notes**: The fix requires either (a) mounting the same volume on both services with matching subpaths, or (b) setting `EXPORT_VOLUME_PATH=/shared/exportedData` on `exporttofile` once it shares the `backtest-data` volume. Test should be re-run post-fix to confirm an exported file becomes readable by a subsequent `/backtest` replay request (see `backtest-streamer-client.md` TC-BTE-002).

### Docker Image Hardcoded Secrets

#### TC-EXP-021: The `ExportToFile` Docker image has a real external MongoDB URI (including credentials and a public IP) baked in as a Dockerfile `ENV` fallback default
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #32
- **Steps**: Inspect `ScheduledServices/ExportToFile/Dockerfile` for the `ENV MONGO_URI=...` line; separately, run the built image standalone with NO `MONGO_URI` override (bypassing `docker-compose.yml`'s runtime env injection)
- **Expected Result** (current bug): The Dockerfile bakes in `ENV MONGO_URI=mongodb://root:example@13.127.182.75:27017/?authSource=admin` — a REAL external host/IP with plaintext credentials, permanently embedded in the image layer. Even though `docker-compose.yml` overrides this at runtime for the normal deployed stack, anyone who pulls or exports this image directly (e.g., from a registry, or via `docker save`) can extract this fallback URI via `docker inspect`/`docker history` without ever running the container, disclosing credentials and an internal/external host IP address that may still be a live, reachable database.
- **Notes**: This is a distinct exposure vector from issue #58 (secrets in git) — this is a secret baked into a BUILD ARTIFACT (the image itself), which may be distributed/cached/pulled independently of the git repository. Recommended fix: use a non-resolving placeholder (e.g., `mongodb://CHANGE_ME:CHANGE_ME@localhost:27017/`) or omit the `ENV` line entirely, forcing every deployment to explicitly supply `MONGO_URI` with no working fallback.

#### TC-EXP-022: Running the image standalone with no `MONGO_URI` override attempts a real connection to the baked-in external host
- **Category**: Negative
- **Priority**: P2
- **Related Issue**: #32
- **Steps**: `docker run` the built `exporttofile` image with no environment overrides, in an isolated network with no route to the baked-in IP
- **Expected Result**: The scheduler/export logic attempts to connect to `13.127.182.75:27017` and fails/times out (since the test environment can't reach it) — confirms the fallback is a LIVE-LOOKING target rather than an obviously-fake placeholder like `localhost`, which increases the risk that a misconfigured deployment could silently exfiltrate/attempt to write data to this unintended external host if it happens to be reachable from a different network context.

### Timestamp Field Consistency (Fixed — Verify)

#### TC-EXP-019: `trades` export correctly uses `created_at` (verify field name matches the current Trade schema)
- **Category**: Regression (verify a previously-fixed issue)
- **Priority**: P1
- **Steps**: Cross-check `exportCollections.js`'s `timeField='created_at'` for `trades` against the actual field name in `BackTest/BackTestApp/src/models/trade.js` (Mongoose timestamps typically produce `createdAt`, camelCase, not `created_at`)
- **Expected Result**: Confirm whether the model uses Mongoose's automatic `timestamps:true` (yielding `createdAt`/`updatedAt`, camelCase) or an explicit custom field named `created_at` (snake_case) — if these don't match, the `$gte`/`$lte` range query silently matches ZERO documents (an absent field is never `>=`/`<=` any Date), producing an always-empty `trades.json` with no error. Document the actual current schema field name and confirm the exporter's `timeField` string is byte-for-byte correct.

#### TC-EXP-020: `ledgers` export correctly uses `created_on` (verify field name matches the current Ledger schema)
- **Category**: Regression (verify a previously-fixed issue)
- **Priority**: P1
- **Steps**: Same cross-check as TC-EXP-019, against the Ledger model's actual timestamp field name
- **Expected Result**: Same class of silent-empty-export risk if `created_on` doesn't exactly match the schema; confirm current alignment and add this as a regression guard for any future schema refactor (e.g., a switch to Mongoose's built-in `timestamps` option would rename these fields and silently break this exporter without any test coverage otherwise).
