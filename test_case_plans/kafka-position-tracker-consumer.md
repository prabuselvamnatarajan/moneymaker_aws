# Kafka: `position-tracker-consumer` — Test Case Plan

## Scope
Consumes live/backtest ticks (`splited-live-data`, `backtest-stream-data`), maintains a Redis-cached "live view" of every OPEN Mongo `positions` document (`position:live:<positionId>` RedisJSON + `position:open:<SYMBOL>` Redis SET index), computes rolling unrealized P&L / excursion (max_up/max_down) on every relevant tick, and throttles writes back to MongoDB (`UNREALISED_WRITE_THROTTLE_MS`, default 2000ms) unless a new excursion extreme is hit (written immediately regardless of throttle). Runs as a single replica (no horizontal scaling — in-memory throttle map would desync across replicas).

## Prerequisites
- MongoDB `BacktestApp.positions` collection with at least one OPEN position for a known symbol
- Redis populated with the corresponding `position:open:<SYMBOL>` set membership and `position:live:<positionId>` cache (normally seeded by `createTrade` in BackTestApp via `syncOpenPositionToRedis`)
- Ability to publish ticks with varying LTP to `splited-live-data`/`backtest-stream-data`

## Test Cases

### Core Tick Processing

#### TC-PTC-001: Tick for a symbol with an open position updates unrealized P&L in Redis immediately
- **Category**: Functional
- **Priority**: P0
- **Steps**: Position OPEN on RELIANCE, entry 100, LONG, open_size 10; publish tick LTP=110
- **Expected Result**: `position:live:<id>` RedisJSON cache updated with `unrealisedPnl = (110-100)*10 = 1000`, `lastLtp:110` — always written to Redis on every tick regardless of throttle ("Always keep Redis hot").

#### TC-PTC-002: Tick for a symbol with NO open positions is a fast no-op
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish a tick for a symbol with an empty `position:open:<SYMBOL>` Redis set
- **Expected Result**: `sMembers` returns empty; handler returns immediately with no Mongo/Redis writes.

#### TC-PTC-003: Multiple open positions on the same symbol (different deployments) all update independently
- **Category**: Functional
- **Priority**: P1
- **Steps**: Two OPEN positions exist for RELIANCE (different `positionMongoId`s in the same open-symbol SET); publish one tick
- **Expected Result**: Both positions' Redis live caches update in the same `Promise.all` batch, each independently computing its own unrealized P&L/excursion based on its own entry price/direction.

### Write Throttling

#### TC-PTC-004: MongoDB write is throttled to at most once per `UNREALISED_WRITE_THROTTLE_MS` when no new extreme is hit
- **Category**: Functional / Performance
- **Priority**: P0
- **Steps**: Publish ticks in rapid succession (faster than 2000ms apart) that oscillate within the already-recorded max_up/max_down range
- **Expected Result**: Redis cache updates on every tick, but MongoDB `positions` document only receives an `updateOne` at most once every 2000ms (per-position throttle tracked in the in-memory `lastUnrealisedWriteAt` Map).

#### TC-PTC-005: A new excursion extreme (max_up/max_down) forces an immediate Mongo write, bypassing throttle
- **Category**: Functional
- **Priority**: P0
- **Steps**: Immediately after a throttled write, publish a tick that sets a NEW all-time high unrealized P&L for the position (breaching prior `max_up`)
- **Expected Result**: `extremeChanged` is true → Mongo write happens immediately regardless of the 2000ms throttle window, ensuring extremes are never lost even under throttling.

#### TC-PTC-006: Throttle state is per-process in-memory — lost on restart
- **Category**: Regression
- **Priority**: P2
- **Steps**: Restart the service mid-throttle-window for an active position; publish a tick immediately after restart
- **Expected Result**: `lastUnrealisedWriteAt` Map resets to empty on restart, so the very next tick after restart always writes (throttle effectively resets) — minor inefficiency, not a correctness bug, but confirms no persistence of throttle timing across restarts.

#### TC-PTC-007: Running multiple replicas of this service would desync throttling (documented single-replica design)
- **Category**: Regression
- **Priority**: P2
- **Steps**: Scale `position-tracker-consumer` to >1 replica (compose currently pins `replicas: 1`); publish ticks and observe if throttle windows are respected consistently
- **Expected Result**: Each replica maintains its own independent `lastUnrealisedWriteAt` Map — if the consumer group assigns the same position's ticks to different replicas across partition rebalances, throttling would be inconsistently applied (more frequent writes than intended). Confirm this justifies the single-replica compose configuration and flag as a scaling constraint.

### Self-Healing Cache

#### TC-PTC-008: Missing Redis live-cache is self-healed from MongoDB on next tick
- **Category**: Functional
- **Priority**: P1
- **Steps**: Manually delete `position:live:<id>` from Redis while the position remains OPEN in Mongo and still a member of `position:open:<SYMBOL>`; publish a tick for that symbol
- **Expected Result**: `selfHealCache` queries Mongo for the OPEN position doc, rebuilds the cache via `buildCacheFromDoc`, re-writes `position:live:<id>`, and re-adds to the open-symbol SET; the tick is then still processed correctly (no permanent state loss from a Redis cache eviction, e.g., under maxmemory-lru pressure per `infrastructure-mongo-redis.md` TC-DB-011).

#### TC-PTC-009: Self-heal correctly removes stale SET membership when the Mongo position is no longer OPEN
- **Category**: Functional
- **Priority**: P1
- **Steps**: A position was closed in Mongo (`status:"CLOSED"`) but its ID lingers in `position:open:<SYMBOL>` Redis SET (e.g., due to a missed cleanup); publish a tick for that symbol
- **Expected Result**: `selfHealCache` detects `!doc || !(doc.open_size>0) || doc.strategy_mode==='BACKTEST'`, deletes the live cache key, and removes the stale ID from the open-symbol SET via `sRem` — self-corrects the index without manual intervention.

#### TC-PTC-010: Self-heal explicitly excludes BACKTEST-mode positions from live tick-driven updates
- **Category**: Functional
- **Priority**: P1
- **Steps**: A BACKTEST-mode position is OPEN; publish a live-topic tick for its symbol (edge case: symbol overlap between live and backtest instruments)
- **Expected Result**: `doc.strategy_mode === 'BACKTEST'` short-circuits self-heal to treat it as absent (returns null, removes from SET) — BACKTEST positions are NOT meant to be updated by this live-tick-driven throttled-write mechanism (backtest excursion tracking is handled separately in BackTestApp's `trade.js` via `updateBacktestExcursions`); confirms no double-tracking/conflicting-write risk between the two subsystems.

#### TC-PTC-011: Self-heal failure (Mongo error) is caught and does not crash the consumer
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate a Mongo error during the self-heal lookup
- **Expected Result**: Error is caught, logged (`Self-heal failed for ...`), function returns null; `updateStrategy` caller aborts processing that position gracefully — no fatal crash.

### LTP Extraction

#### TC-PTC-012: `extractLtp` handles both simplified `{ltp}` and full Upstox feed shapes
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish two ticks: one with `{ltp: 150.5}` directly, one with a full `fullFeed.marketFF.ltpc.ltp` nested structure
- **Expected Result**: Both extract the correct numeric LTP via `excursionMath.js#extractLtp`; ticks with neither shape (or non-numeric LTP) are safely ignored (`ltp == null || !(ltp > 0)` guard).

#### TC-PTC-013: Zero or negative LTP values are ignored
- **Category**: Negative
- **Priority**: P2
- **Steps**: Publish a tick with `ltp: 0` or `ltp: -5`
- **Expected Result**: Guard `!(ltp > 0)` skips processing entirely — no spurious P&L computation from bad tick data.

### Malformed Input & Resilience

#### TC-PTC-014: Message with missing/empty key is skipped without error
- **Category**: Negative
- **Priority**: P2
- **Steps**: Publish a message with `key: null` or empty string
- **Expected Result**: `if (!symbol) return;` guard prevents any downstream lookup/crash.

#### TC-PTC-015: Malformed JSON tick value triggers `handleFatalError`
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish invalid JSON as message value
- **Expected Result**: Parse error caught, routed to `handleFatalError(error, 'message handling on <topic>')`.

#### TC-PTC-016: Startup order — Mongo, then Redis, then Kafka consumer, in that sequence
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trace `createConsumer()` connection order
- **Expected Result**: MongoDB connects first (positions collection handle obtained), then Redis, then Kafka consumer subscribes and starts consuming — confirms no tick processing can begin before both data stores are ready.
