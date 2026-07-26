# Backtest Streamer & Client — Test Case Plan

## Scope
Covers the two-hop backtest data replay pipeline: `BacktestStreamer` (`streamer.js`, a raw WebSocket server on port 8085 exposed publicly as `wsbacktest`, reading exported JSON files from disk and replaying them tick-by-tick) and `BacktestClient` (`clientServer.js`, an Express HTTP endpoint on port 3000 exposed publicly as `/backtest`, which opens a WS connection to the Streamer and republishes each tick onto Kafka topic `backtest-stream-data`). Together these feed the `StrategyChooserConsumer` for backtest runs.

## Prerequisites
- `BacktestStreamer` running with `SHARED_DIR` pointing at a directory containing `exportedData/<date>/<symbol>.json` files
- `BacktestClient` running with `WS_URL` pointing at the Streamer and `KAFKA_BROKERS`/`KAFKA_TOPIC` configured
- Sample exported JSON files for at least one symbol/date under `exportedData/`
- A way to trigger `GET /backtest?symbolName=...&date=...` through nginx (or directly against `clientServer.js`) and observe both the raw WS stream and the resulting Kafka messages

## Test Cases

### Streamer — Happy Path Replay

#### TC-BTS-001: Valid `symbolName`+`date` streams all ticks from the corresponding JSON file in order
- **Category**: Functional
- **Priority**: P0
- **Steps**: Connect to `wsbacktest`, send `{symbolName:"RELIANCE", date:"2024-06-01"}` for a file with N known records
- **Expected Result**: Client receives exactly N tick messages in file order, followed by `{done:true}`.

#### TC-BTS-002: `time_ms` throttles replay speed between ticks
- **Category**: Functional
- **Priority**: P1
- **Steps**: Send the same request with `time_ms:100`
- **Expected Result**: Each tick is delayed by ~100ms from the previous (`setTimeout` between sends); total elapsed time ≈ `100 * (N-1)`ms.

#### TC-BTS-003: `time_ms` omitted or ≤0 streams all ticks as fast as possible
- **Category**: Functional
- **Priority**: P1
- **Steps**: Omit `time_ms`, or send `time_ms:0`
- **Expected Result**: All ticks sent back-to-back with no artificial delay (the `typeof time_ms === 'number' && time_ms > 0` check is false).

#### TC-BTS-004: Missing `symbolName` or `date` returns a structured error, no crash
- **Category**: Negative
- **Priority**: P1
- **Steps**: Send `{date:"2024-06-01"}` (no symbolName), and separately `{symbolName:"X"}` (no date)
- **Expected Result**: `{error:"Missing symbolName or date"}` returned in both cases; connection stays open for further messages.

#### TC-BTS-005: Invalid JSON payload returns `{error:"Invalid JSON"}`
- **Category**: Negative
- **Priority**: P2
- **Steps**: Send a non-JSON string over the WS connection
- **Expected Result**: Caught by the `try/catch` around `JSON.parse`; error response sent; connection not dropped.

#### TC-BTS-006: Nonexistent file (symbol/date combination with no export) returns a filesystem error message
- **Category**: Negative
- **Priority**: P1
- **Steps**: Request a `symbolName`/`date` with no matching exported file
- **Expected Result**: `fs.readFile` rejects (ENOENT); caught and returned as `{error: err.message}` — verify the raw Node error message (including the resolved file path) is NOT overly informative for an unauthenticated caller (information disclosure of internal directory structure).

#### TC-BTS-007: Malformed file content (not valid JSON, or valid JSON but not an array) is rejected safely
- **Category**: Negative
- **Priority**: P2
- **Steps**: Place a file containing `{"not":"an array"}` or truncated/invalid JSON at the expected path; request it
- **Expected Result**: For invalid JSON: `getSourceData`'s `JSON.parse` throws, caught and returned as an error. For valid-JSON-non-array: explicit `if (!Array.isArray(data))` guard returns `{error:'Data format error'}` before attempting to iterate.

### Streamer — Path Traversal (Critical Security)

#### TC-BTS-008: `symbolName` traversal attempt is neutralized by `sanitize()`
- **Category**: Security / Positive Control
- **Priority**: P0
- **Related Issue**: #27
- **Steps**: Send `{symbolName:"../../../../etc/passwd", date:"2024-06-01"}`
- **Expected Result**: `sanitize()` strips all characters outside `[a-zA-Z0-9-_]`, collapsing the traversal payload into underscores — no path escape via the symbol parameter.

#### TC-BTS-009: `date` traversal is NOT sanitized — arbitrary file read from the container filesystem
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #27
- **Steps**: Send `{symbolName:"AAPL", date:"../../../../../etc"}` (or any relative path escaping `exportedData/`) directly to the Streamer's WS endpoint on port 8085 (or, in the deployed topology, via the public `/backtest` HTTP endpoint which forwards the raw `date` query param unchanged, per `BacktestClient/clientServer.js:L42`)
- **Expected Result** (current bug): `date` is interpolated into `path.join(SHARED_DIR, 'exportedData', date, ...)` with ZERO sanitization. A crafted `date` value escapes the `exportedData/` root, allowing arbitrary file reads anywhere the process has read permission (e.g., `date:"../../../../"` + a crafted `symbolName` matching a known filename elsewhere in the container, such as `.env` or application source). Since `wsbacktest` is exposed unauthenticated on nginx ports 80/443, this is remotely exploitable by any anonymous user.
- **Notes**: This is the single highest-priority security test in the entire backtest pipeline. Verify with a concrete PoC: attempt to read a known non-`exportedData` file (e.g., `/app/package.json` if colocated) and confirm its contents are streamed back to the WS client as (invalid, but readable) tick data / error message leaking file content.

#### TC-BTS-010: `date` containing null bytes or absolute paths is not blocked
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #27
- **Steps**: Try `date` values that are absolute paths (e.g., `/etc`) — `path.join` with an absolute second-ish segment behavior in Node should still be tested empirically
- **Expected Result**: Document actual `path.join` resolution behavior for absolute-path injection in the `date` segment; confirm whether this provides an even more direct traversal vector than relative `../` sequences.

#### TC-BTS-011: `BacktestClient`'s `/` endpoint forwards the unsanitized `date` query param verbatim to the Streamer
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #27
- **Steps**: Call `GET /backtest?symbolName=AAPL&date=../../../../etc` through the public nginx route
- **Expected Result**: `clientServer.js` does not validate `date` against a `YYYY-MM-DD` format before including it in the WS payload sent to the Streamer — confirms the vulnerability is reachable end-to-end from the public internet-facing endpoint, not just from a direct (internal-only) connection to the Streamer.

### BacktestClient — Authentication Gap (Critical Security)

#### TC-BTC-001: `GET /` (public `/backtest` route) requires zero authentication
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #28
- **Steps**: Call `GET /backtest?symbolName=X&date=Y` anonymously (no `Authorization` header, no `X-Service-Token`), through the public nginx exposure
- **Expected Result** (current bug): Request succeeds fully — no `authenticate`/`requireServiceToken` middleware guards this route at all, unlike other internal-to-internal integrations (e.g., `deploymentSymbolResolverConsumer` → BackTestApp, which use `BACKTEST_SERVICE_TOKEN`). Any anonymous internet user can trigger a full backtest-data replay into Kafka.

#### TC-BTC-002: Caller-supplied `deployment_id` is trusted and stamped onto every produced Kafka message with no ownership check
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #28
- **Steps**: Call `GET /backtest?symbolName=X&date=Y&deployment_id=<victim's real deployment ID>` as an anonymous/unrelated caller
- **Expected Result** (current bug): Every streamed tick has `parsed.deployment_id` overwritten to the attacker-supplied value (`clientServer.js:L99-105`) with NO check that the caller owns or is authorized to act on that `deployment_id`. These spoofed messages flow into `backtest-stream-data` and are subsequently consumed by `StrategyChooserConsumer` and routed to the victim's deployment's strategy topic, corrupting their backtest results with attacker-controlled tick data and timing.

#### TC-BTC-003: Anonymous flood of `/backtest` requests can DoS the `backtest-stream-data` topic
- **Category**: Security / Performance
- **Priority**: P1
- **Related Issue**: #28
- **Steps**: Issue many concurrent `GET /backtest` requests with large/slow-draining files and `time_ms:0` (max throughput)
- **Expected Result**: Each request opens an unbounded WS connection to the Streamer and a Kafka producer batch loop with no rate limiting or concurrency cap — document resource exhaustion behavior (open WS handles, Kafka producer backlog, memory from the unbounded in-memory `queue` array) under load; confirms a viable DoS vector against the shared Kafka topic used by all real backtests.

#### TC-BTC-004: Same-origin nginx routing exposes `/backtest` right alongside the equally unauthenticated `/clientstreamer` (compounding risk)
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #28, #60
- **Steps**: Review `nginx.conf` public location blocks together
- **Expected Result**: Cross-reference `infrastructure-nginx-reverse-proxy.md` — confirm both routes lack auth, compounding the overall unauthenticated attack surface on the backtest pipeline.

### BacktestClient — Functional / Kafka Production

#### TC-BTC-005: Missing `symbolName` or `date` on `/backtest` returns HTTP 400
- **Category**: Negative
- **Priority**: P1
- **Steps**: `GET /backtest` with no query params, and with only one of the two required params
- **Expected Result**: `400 Missing symbolName or date` in both cases; no WS connection attempted.

#### TC-BTC-006: Invalid (non-numeric or negative) `time_ms` returns HTTP 400
- **Category**: Negative
- **Priority**: P2
- **Steps**: `GET /backtest?symbolName=X&date=Y&time_ms=abc` and `time_ms=-5`
- **Expected Result**: `400 Invalid time_ms: must be a number >= 0` in both cases.

#### TC-BTC-007: Each tick received from the Streamer is enqueued and produced to Kafka in batches of up to 100
- **Category**: Functional
- **Priority**: P1
- **Steps**: Stream a file with > 250 records; monitor `producer.send` calls
- **Expected Result**: Messages are drained from the internal `queue` in batches of exactly 100 (`queue.splice(0,100)`) via `processQueue`, each batch sent as one `producer.send` call; total messages across all batches equals the file's record count.

#### TC-BTC-008: `run_id` is appended to the message payload only when provided
- **Category**: Functional
- **Priority**: P2
- **Steps**: Call with `deployment_id` and `run_id` both set, and separately with only `deployment_id`
- **Expected Result**: `run_id` field present in the produced Kafka message only in the first case — confirms conditional field injection works as coded (also confirms `run_id` has the SAME lack of ownership validation as `deployment_id`, per TC-BTC-002).

#### TC-BTC-009: A tick message that fails `JSON.parse` when `deployment_id` is set is still enqueued (unmodified), not dropped
- **Category**: Negative
- **Priority**: P2
- **Steps**: Have the Streamer emit a non-JSON-parseable message (e.g., simulate corrupted data) while `deployment_id` is set on the client request
- **Expected Result**: `clientServer.js`'s inner `catch` around `JSON.parse(msgStr)` logs an error but the original (unmodified) `msgStr` is still pushed to `queue` — this message reaches Kafka WITHOUT the `deployment_id` tag, silently breaking the tagging contract for that one message rather than dropping it or failing loudly.

#### TC-BTC-010: Unused `partitionKey` is computed but never passed to `producer.send` — messages key on raw `symbolName` only
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #34
- **Steps**: Inspect the Kafka message key for produced messages across multiple dates/time_ms values for the same symbol
- **Expected Result**: All messages for a given `symbolName` land in the same partition (keyed by raw `symbolName`, `clientServer.js:L83`), regardless of `date`/`time_ms` — the computed composite `partitionKey` (which WOULD have spread load across partitions by symbol+date+time) is dead code, confirming no benefit is derived from the extra computation; if the topic has multiple partitions, verify this results in uneven partition distribution when many concurrent backtests target the same symbol across different dates.

#### TC-BTC-011: `producer.send` failure is caught and logged per-batch, does not crash the request or halt subsequent batches incorrectly
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate a Kafka broker outage mid-stream
- **Expected Result**: Each failed batch's error is caught and logged (`console.error('Kafka produce error:'...)`) inside the `while (queue.length > 0)` loop; the loop continues attempting subsequent batches (which will also fail) rather than exiting — confirms NO backoff/retry and NO eventual give-up, meaning a sustained Kafka outage during a large replay results in silent, repeated failed-send attempts for the entire remainder of the file with no operator visibility beyond logs, and no error surfaced to the original HTTP caller (the `res.send('WebSocket client started...')` response was already sent synchronously before any of this happens).

#### TC-BTC-012: WS connection to the Streamer failing/closing mid-stream is logged but leaves any already-queued Kafka messages to drain normally
- **Category**: Negative
- **Priority**: P2
- **Steps**: Kill the Streamer process mid-replay
- **Expected Result**: `ws.on('error')`/`ws.on('close')` handlers log the event; no further ticks are enqueued, but the `processQueue` loop finishes draining whatever was already in `queue` before returning to idle.

### End-to-End Pipeline Integration

#### TC-BTE-001: A full replay round-trip — HTTP trigger → Streamer file read → Kafka produce → StrategyChooserConsumer fan-out — delivers ticks to the correct strategy topic tagged with the requested `deployment_id`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Trigger `/backtest` for a deployment with a known `strategy_name`/`deployment_id`; observe the corresponding `<strategy>_backtest_data` topic
- **Expected Result**: Ticks appear on the correct downstream topic with the correct `deployment_id` field, matching `StrategyChooserConsumer`'s routing logic (see `kafka-strategy-chooser-consumer.md`).

#### TC-BTE-002: The disconnected-volumes bug (#53) means real exported production data is generally NOT present at the path this pipeline reads from
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #53
- **Steps**: Run the real `exporttofile` scheduled export, then immediately attempt a `/backtest` replay for the same symbol/date it just exported
- **Expected Result** (current bug): `exporttofile` writes to `/exported_stock_data/<date>/...` (volume `exported_stock_data`, no `exportedData` subfolder) while the Streamer reads from `/shared/exportedData/<date>/<symbol>.json` (volume `backtest-data`) — these are two entirely disconnected Docker volumes never mounted on any common service. The replay fails with a file-not-found error (per TC-BTS-006) even though the export "succeeded," because the data physically lives in a different volume than where this pipeline looks. See `infrastructure-docker-compose.md` and `backtest-data-export.md` for the export-side detail.
