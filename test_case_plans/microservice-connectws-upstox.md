# MicroService: ConnectWS-Upstox — Test Case Plan

## Scope
Covers `MicroServices/ConnectWS-Upstox` (`server.js` + `websocket.js`), the service responsible for establishing and maintaining a single persistent WebSocket connection to Upstox's V3 market-data feed, decoding protobuf `FeedResponse` frames, and publishing decoded ticks onto Kafka topic `incoming-ws-msg` for downstream consumption by `wsDataSplitterConsumer`. Also manages dynamic symbol subscribe/unsubscribe via a Redis pub/sub channel (`symbol_updates`) and auto-reconnect with exponential backoff.

## Prerequisites
- Valid Upstox access token cached in Redis (global default and/or per-user)
- Kafka reachable for `incoming-ws-msg` topic
- Redis reachable for `symbol_updates` pub/sub and `strategies:live:*` / `symbols:active` key inspection
- Ability to simulate/mock the upstream Upstox WebSocket feed (valid frames, malformed frames, disconnects)

## Test Cases

### HTTP Trigger Endpoint

#### TC-CWS-001: `GET /?symbol=X` initiates (or reuses) a WebSocket connection and subscribes to the given symbol(s)
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_EQ|INE002A01018`
- **Expected Result**: `get_WS_URL` called with the global-default access token; if no active WS exists, a new connection is opened and the symbol queued for subscription once open; response is the placeholder text `"Varataa Mamee tuuurrrr...."` (200) — note this endpoint responds immediately without waiting for the actual subscription/connection to complete (fire-and-forget).

#### TC-CWS-002: Multiple `symbol` query params are correctly collected into an array
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /?symbol=A&symbol=B`
- **Expected Result**: Express parses repeated query params into an array automatically; `Array.isArray` check passes through unchanged; both symbols subscribed.

#### TC-CWS-003: A single `symbol` param (not repeated) is correctly wrapped into a single-element array
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /?symbol=A`
- **Expected Result**: `!Array.isArray(symbols)` wraps it as `[symbols]` before passing to `get_WS_URL`.

#### TC-CWS-004: This HTTP trigger ALWAYS uses the global default token — ignores any per-user context entirely
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #26
- **Steps**: `GET /?symbol=X` — inspect `server.js`'s call to `getAccessTokenFromRedis()` (line 25, no argument passed)
- **Expected Result** (current bug): Regardless of which user's deployment/strategy actually wants to subscribe to symbol X, the connection is always authenticated using the GLOBAL default token (whichever user most recently logged in, per issue #10's related bug) — inconsistent with the per-user token plumbing implemented everywhere else (`websocket.js`'s own `getUserIdForSymbol`/Redis-driven auto-subscribe flow DOES resolve a `userId`, making this HTTP trigger path the one inconsistent holdout). If the wrong user's token lacks entitlement/subscription for the requested symbol, or if using the wrong user's token has billing/quota implications on Upstox's side, this manifests as subtly wrong behavior with no error surfaced.

### Auto-Subscribe on Startup & Redis-Driven Subscription

#### TC-CWS-005: On startup, `initRedisSubscriber` auto-subscribes to symbols derived from BOTH `strategies:live:*` keys and the `symbols:active` set
- **Category**: Functional
- **Priority**: P0
- **Steps**: Seed Redis with `strategies:live:SYM1` (any value) and `symbols:active` containing `SYM2`; start the service
- **Expected Result**: Both `SYM1` and `SYM2` are added to `activeSymbols` and a connection is auto-initiated to subscribe to both — confirms the two independent symbol-tracking mechanisms are correctly unioned (`Array.from(new Set([...deploymentSymbols, ...activeSymbolsList]))`).

#### TC-CWS-006: `symbol_updates` pub/sub message with `action:"subscribe"` adds and subscribes a new symbol, using the message's `userId` if present
- **Category**: Functional
- **Priority**: P0
- **Steps**: Publish `{action:"subscribe", instrument_token:"NEW_SYM", userId:"user1"}` to `symbol_updates`
- **Expected Result**: `subscribeSymbols(['NEW_SYM'], 'user1')` called; if no active WS, `ensureWSConnection('user1')` triggers using `user1`'s token (correct per-user resolution, UNLIKE the HTTP trigger path in TC-CWS-004).

#### TC-CWS-007: `action:"unsubscribe"` correctly removes a symbol from both the active-tracking set and the live WS subscription
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish `{action:"unsubscribe", instrument_token:"SYM1"}` while SYM1 is actively subscribed
- **Expected Result**: `unsubscribeSymbols(['SYM1'])` sends an `unsub` frame to Upstox (if WS open) and removes SYM1 from both `activeSymbols` and `subscribedSymbols`.

#### TC-CWS-008: `action:"update"` atomically unsubscribes the old token and subscribes the new one (e.g., option contract rollover)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish `{action:"update", old_instrument_token:"OLD", instrument_token:"NEW", userId:"user1"}`
- **Expected Result**: `OLD` unsubscribed, `NEW` subscribed — models the deployment-symbol-resolver's dynamic option-strike-rollover use case correctly.

#### TC-CWS-009: Malformed JSON on the `symbol_updates` channel is caught and logged, not fatal
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish a non-JSON string to `symbol_updates`
- **Expected Result**: `JSON.parse` failure caught inside the subscriber callback's own try/catch; error logged; subsequent messages still processed normally.

#### TC-CWS-010: When the WS is not yet open, symbols are queued and a connection is auto-triggered using a resolved `userId` (from message or `getUserIdForSymbol` lookup)
- **Category**: Functional
- **Priority**: P1
- **Steps**: With no active WS, call `subscribeSymbols(['SYM'], '')` (no userId given)
- **Expected Result**: `resolveUserId()` falls back to `getUserIdForSymbol('SYM')`, which reads `strategies:live:SYM` from Redis and extracts `activeStrategies[0].user_id` — confirms an automatic per-symbol user-resolution mechanism exists as a fallback when the caller doesn't specify one.

#### TC-CWS-011: `getUserIdForSymbol` gracefully returns `''` if Redis is unreachable, `REDIS_URL` is unset, or the key has no matching strategy data
- **Category**: Negative
- **Priority**: P2
- **Steps**: Test each of: unset `REDIS_URL`, Redis connection failure, and a `strategies:live:X` key with empty `activeStrategies`
- **Expected Result**: All three degrade to returning `''` without throwing; `ensureWSConnection('')` proceeds using the (problematic, per issue #10) global default token rather than failing outright.

### Reconnection & Resilience

#### TC-CWS-012: WS `close` event triggers exponential-backoff reconnect ONLY if there are still active symbols of interest
- **Category**: Functional
- **Priority**: P1
- **Steps**: Close the WS while `activeSymbols` is non-empty, and separately while it's empty
- **Expected Result**: Reconnect scheduled in the first case (`scheduleReconnect`); NO reconnect attempt in the second case (`if (activeSymbols.size===0) return;`) — avoids pointless reconnection when nothing needs streaming.

#### TC-CWS-013: Reconnect delay follows exponential backoff capped at 60 seconds
- **Category**: Functional
- **Priority**: P2
- **Steps**: Force repeated connection failures; measure delay between attempts
- **Expected Result**: `delay = min(1000 * 2^attempt, 60000)` — verify attempts 0,1,2,3... produce 1s, 2s, 4s, 8s... up to the 60s cap; `reconnectAttempt` resets to 0 upon a successful `open`.

#### TC-CWS-014: Concurrent reconnect scheduling is de-duplicated (only one pending timer at a time)
- **Category**: Regression
- **Priority**: P2
- **Steps**: Trigger both a `close` and an `error` event in quick succession (both call `scheduleReconnect`)
- **Expected Result**: `if (reconnectTimer) return;` guard prevents a second overlapping timer from being scheduled — only one reconnect attempt fires.

#### TC-CWS-015: 401 (expired/invalid token) errors on the WS are logged with a clear "re-authenticate" message rather than a generic error dump
- **Category**: Functional
- **Priority**: P2
- **Steps**: Simulate Upstox rejecting the WS handshake with a 401
- **Expected Result**: Specific user-friendly log message triggered by the `message.includes('401')` check — helps operators quickly diagnose an expired-token situation vs. a network/other error.

### Kafka Producer Leak on Reconnect (Critical Regression)

#### TC-CWS-016: Every single reconnect attempt creates a BRAND NEW Kafka client + producer; the old one is never disconnected
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #20
- **Steps**: Force N consecutive reconnects (e.g., by repeatedly killing the mock Upstox WS server); monitor the count of distinct Kafka producer connections established by this service over time (e.g., via Kafka broker's connection/client metrics, or by instrumenting `producer.connect()` calls)
- **Expected Result** (current bug): `connectWebSocket` (called fresh on every `get_WS_URL` invocation, which happens on every reconnect per `scheduleReconnect`→`ensureWSConnection`→`get_WS_URL`) instantiates a NEW `Kafka` client and calls `producer.connect()` EVERY time, but no corresponding `producer.disconnect()` is ever called for the OLD producer from the previous connection attempt — confirmed via `websocket.js:L300-319`. After N reconnects (e.g., due to a flaky upstream network causing frequent WS drops), N leaked producer connections accumulate, each holding open TCP sockets/broker metadata caches, until the process exhausts file descriptors or memory and crashes — a slow-burn resource exhaustion vulnerability directly caused by network instability, the very condition reconnect logic is meant to handle gracefully.
- **Notes**: Recommended fix: create the Kafka producer ONCE at module scope (outside `connectWebSocket`), reuse it across all reconnects, and only disconnect it on process shutdown (SIGTERM handler). Verify post-fix that producer connection count stays constant regardless of reconnect frequency.

#### TC-CWS-017: Under sustained network flakiness (frequent disconnect/reconnect cycles over hours), the service eventually exhausts sockets/memory and crashes
- **Category**: Performance / Regression
- **Priority**: P1
- **Related Issue**: #20
- **Steps**: Long-running soak test: simulate a reconnect every 30 seconds for several hours (accelerated: every 1 second for a shorter window) against a test Kafka broker
- **Expected Result**: Document the actual time-to-failure/resource-growth curve — confirms the practical severity and provides a concrete "before/after" benchmark once the fix (module-scoped producer reuse) is applied.

### Unhandled Rejection on Malformed Frames (Critical Regression)

#### TC-CWS-018: A malformed/corrupted protobuf frame from Upstox crashes the ENTIRE market-data ingestion process
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #21
- **Steps**: Inject a deliberately corrupted binary frame into the mocked Upstox WS connection's `message` event (e.g., truncated protobuf bytes, or bytes that don't match the `FeedResponse` schema at all)
- **Expected Result** (current bug): The `ws.on('message', async (data) => {...})` handler (`websocket.js:L378-392`) has NO try/catch around `decodeProfobuf(data)`, the subsequent `JSON.stringify`/`JSON.parse` round-trip, or `producer.send`. A malformed frame causes `FeedResponse.decode(buffer)` to throw inside the async handler — since this is an async event-listener callback with no surrounding try/catch, the rejection becomes an UNHANDLED PROMISE REJECTION, which (Node.js ≥15 default behavior) terminates the entire process. This kills market-data ingestion for ALL subscribed symbols simultaneously, not just processing of the one bad frame — a single corrupted upstream frame (which the service has no control over) can take down live price feeds system-wide.
- **Notes**: This is a critical live-trading availability risk: MSB/msb_pts/liquidity_sweep strategies all depend on this feed for real-time signals; a crash here silently stalls all live strategies until Swarm restarts the container (during which time, no trades are placed even if the market moves significantly). Recommended fix: wrap the entire handler body in try/catch, log and discard bad frames instead of propagating the throw.

#### TC-CWS-019: A Kafka `producer.send` failure during message processing ALSO crashes the process (no try/catch covers this call either)
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #21
- **Steps**: With a VALID, correctly-decoded protobuf frame, simulate a `producer.send` rejection (e.g., Kafka broker unreachable at that moment)
- **Expected Result** (current bug): Same root cause as TC-CWS-018 — the `await producer.send(...)` call inside the unguarded async handler propagates its rejection as an unhandled rejection, crashing the process. This means EITHER a malformed upstream frame OR a transient Kafka hiccup can independently kill live market-data ingestion — two independent single points of failure sharing one missing try/catch.

#### TC-CWS-020: Post-crash restart behavior — does the service correctly resume subscriptions after a Swarm-triggered restart?
- **Category**: Negative
- **Priority**: P1
- **Steps**: After inducing the crash from TC-CWS-018/019, allow Docker Swarm to restart the container; observe behavior on cold start
- **Expected Result**: `initRedisSubscriber`'s startup auto-subscribe logic (TC-CWS-005) re-derives the active symbol list from Redis (`strategies:live:*` + `symbols:active`) and re-establishes the WS connection + subscriptions from scratch — verify no permanent loss of "which symbols should be live" state across a crash/restart cycle (state survives in Redis, only the in-memory WS connection and `activeWS`/`subscribedSymbols` are lost and correctly rebuilt).

### Kafka Message Production

#### TC-CWS-021: Every decoded feed batch is published to `incoming-ws-msg` with a fixed key `uplink_ws_data` (no per-symbol keying)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Decode a frame containing multiple symbols' feeds in one message
- **Expected Result**: All feeds for the batch are JSON-stringified together and produced as ONE Kafka message with key `'uplink_ws_data'` — confirms downstream (`wsDataSplitterConsumer`) is responsible for splitting this combined payload into per-symbol messages (cross-reference `kafka-wsdatasplitter-consumer.md`); also confirms all such messages land on the SAME partition (fixed key), which could create a hot-partition bottleneck under high tick volume across many symbols.

#### TC-CWS-022: Frames with no `feeds` property (e.g., pure heartbeat/control frames from Upstox) are silently skipped, not treated as errors
- **Category**: Functional (positive control)
- **Priority**: P2
- **Steps**: Simulate a decoded frame with no `feeds` key
- **Expected Result**: `if (decodedData && decodedData.feeds)` guard skips the Kafka publish entirely for non-feed control frames — correct, low-noise handling for protocol-level keepalive frames.
