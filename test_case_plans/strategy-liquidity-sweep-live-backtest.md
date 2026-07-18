# Strategy: liquidity_sweep — Live & Backtest — Test Case Plan

## Scope
Covers the `liquidity_sweep` strategy consumer (`kafka/services/Strategies/liquidity_sweep`), a market-microstructure state machine (`IDLE → SWEEP_ACTIVE → PENDING_ENTRY/IN_POSITION → COOLDOWN`) that detects liquidity sweeps of key levels (prior day high/low, session levels), confirms absorption, applies configurable filters, executes entries, and manages open positions with account-scoped concurrency limits. Deployed as `liquidity-sweep-strategy` (live) and `liquidity-sweep-strategy-backtest` (backtest, `IS_BACKTEST:"true"`).

## Prerequisites
- Redis, `PLACEORDER_API`, `GET_OHLC_API` (for prior-day-high/low fetch), `SWEEP_LOG_API` (BackTestApp sweep-signal logging, service-token authenticated) all reachable
- A RUNNING deployment with `maxConcurrentTrades` and strategy params configured (`config/defaultParams.js`)
- Ability to construct synthetic tick sequences that produce a data gap, a sweep, absorption, and a full entry/exit cycle

## Test Cases

### State Machine Core

#### TC-LSW-001: Fresh state initializes to `IDLE` with level tracking seeded from the first tick
- **Category**: Functional
- **Priority**: P0
- **Steps**: First-ever tick for a new deployment/symbol
- **Expected Result**: `createInitialState` returns `machineState:"IDLE"`, `tickBuffer:[]`, initial levels from `createInitialLevelState`, `metrics:{avgAbsDelta:1, avgVolumeRate:1}`.

#### TC-LSW-002: Prior-day OHLC is fetched once per session and cached (`priorDayFetched`)
- **Category**: Functional
- **Priority**: P1
- **Steps**: First tick of a new trading session; verify `fetchPriorDayOHLC` is called exactly once and `prevDayHigh`/`prevDayLow` levels are set
- **Expected Result**: Subsequent ticks within the same session (`sessionMeta.sessionDate` unchanged) do NOT re-fetch; a new session date triggers exactly one re-fetch.

#### TC-LSW-003: `IDLE` state transitions to `SWEEP_ACTIVE` when `detectSweep` fires
- **Category**: Functional
- **Priority**: P0
- **Steps**: Construct a tick sequence where price sweeps below/above an active level per `detectSweep`'s criteria
- **Expected Result**: `machineState→"SWEEP_ACTIVE"`, `state.sweep` populated with sweep metadata and `tickCount:0`.

#### TC-LSW-004: `SWEEP_ACTIVE` transitions to a trade signal via `processAbsorption`, filtered by `passesFilters`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Continue the tick sequence with absorption characteristics (per `modules/absorption.js` criteria) that produce a `signal`
- **Expected Result**: If `passesFilters` passes, either `machineState→"PENDING_ENTRY"` (if `params.entryOnNextTick`) or immediate `attemptEntry` is called; if filters reject, state resets to `IDLE` via `resetSweepState` with the rejection reason logged.

#### TC-LSW-005: `PENDING_ENTRY` executes on the next tick via `tryExecuteEntry`
- **Category**: Functional
- **Priority**: P0
- **Steps**: With `machineState:"PENDING_ENTRY"` and a `pendingSignal` set, feed the next tick
- **Expected Result**: `attemptEntry` re-checks filters against the new tick, then calls `tryExecuteEntry`; on success, `machineState→"IN_POSITION"`, `position` set; on failure/filter-reject, resets to `IDLE`.

#### TC-LSW-006: `IN_POSITION` delegates every subsequent tick to `manageOpenPosition` until closed
- **Category**: Functional
- **Priority**: P0
- **Steps**: With an open position, feed several ticks approaching and then hitting an exit condition (target/SL/time-based per `tradeManagement.js`)
- **Expected Result**: State stays `IN_POSITION` until `manageOpenPosition` determines an exit, at which point it transitions appropriately (likely to `COOLDOWN` or `IDLE`) and clears `position`.

#### TC-LSW-007: `COOLDOWN` blocks new sweep detection until `cooldownUntil` elapses
- **Category**: Functional
- **Priority**: P1
- **Steps**: After a position closes into `COOLDOWN` with `cooldownUntil` set; feed ticks both before and after that timestamp
- **Expected Result**: Before: state remains `COOLDOWN`, no sweep detection runs. At/after: `machineState→"IDLE"`, `cooldownUntil` cleared, normal sweep detection resumes.

### Data Gap Handling

#### TC-LSW-008: A tick-timestamp gap exceeding `gapThresholdSec` resets sweep-in-progress state
- **Category**: Functional
- **Priority**: P1
- **Steps**: Feed a tick whose timestamp is far beyond `state.lastLtt + gapThresholdSec` while `machineState` is `SWEEP_ACTIVE`
- **Expected Result**: `handleDataGap` logs a warning, calls `logSweepOutcome(..., 'data_gap', ...)` for the in-progress sweep, resets `sweep`/`pendingSignal`/`tickBuffer`, and sets `machineState` to `IN_POSITION` (if a position exists), `COOLDOWN` (if still within cooldown), or `IDLE` otherwise — correctly preserves an open position across a data gap rather than losing track of it.

#### TC-LSW-009: A data gap while `IN_POSITION` does NOT discard the open position
- **Category**: Functional
- **Priority**: P0
- **Steps**: Data gap occurs while a position is open
- **Expected Result**: `handleDataGap`'s ternary explicitly checks `state.position` first — machineState resolves to `"IN_POSITION"`, and the position object itself is untouched by the reset (only sweep/tickBuffer state is cleared) — critical for not losing risk management on an open live trade due to a feed gap.

### Concurrency Control (Core Regression Area)

#### TC-LSW-010: `reserveOpenSlot` correctly blocks entry when `maxConcurrentTrades` is reached for the account
- **Category**: Functional
- **Priority**: P0
- **Steps**: Account already has `maxConcurrentTrades` (e.g., 3) open positions tracked via `liquidity_sweep:open:<accountId>`; attempt a new entry for a 4th deployment on the SAME account
- **Expected Result**: `reserveOpenSlot` increments the counter, sees `newCount > maxConcurrentTrades`, decrements back, and returns `false` — `tryExecuteEntry` should then skip the entry (verify `tradeManagement.js` correctly interprets a `false` reservation as "no room, don't open").

#### TC-LSW-011: Concurrency counter is scoped by `accountId` ONLY, not by `deployment_id` — cross-deployment interference
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #65
- **Steps**: Two DIFFERENT deployments (different `deployment_id`, different strategies or same strategy on different symbols) both trade against the SAME `account_id`; deployment A opens 2 positions, deployment B attempts to open a 3rd when `maxConcurrentTrades:2` (a limit presumably intended per-deployment)
- **Expected Result** (current bug): Because `openCountKey(accountId)` has no `deployment_id` component, deployment B's entry attempt is blocked by deployment A's already-open positions sharing the exact same Redis counter — the two deployments unintentionally share one combined concurrency budget rather than each having their own, even though they may represent entirely independent trading strategies/symbols run by the same account.

#### TC-LSW-012: Resetting ONE backtest deployment on a shared account wipes the concurrency counter for ALL other deployments on that account
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #65
- **Steps**: Deployment A (liquidity_sweep, account X) has 2 open positions tracked in `liquidity_sweep:open:X`; deployment B (also liquidity_sweep, SAME account X, currently RUNNING live/paper) also has open positions contributing to the same counter; trigger `start`/`restart` on deployment A (a BACKTEST deployment) via BackTestApp
- **Expected Result** (current bug): `resetBacktestDeployment` in `deployment.js` (line ~499 per issue #65) explicitly does `client.del(`liquidity_sweep:open:${accountIdStr}`)` — this deletes the ENTIRE shared counter, not just deployment A's contribution, silently zeroing out deployment B's legitimately-tracked open-position count even though deployment B was never touched by the reset request. Deployment B's subsequent `reserveOpenSlot` calls will now under-count its true exposure, potentially allowing it to exceed its intended `maxConcurrentTrades`.
- **Notes**: This is a cross-deployment blast-radius bug — resetting deployment A directly corrupts deployment B's risk controls with no warning.

#### TC-LSW-013: `decrementOpenPositions` never goes negative (clamped to 0)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Call `decrementOpenPositions` more times than `incrementOpenPositions`/`reserveOpenSlot` for an account (e.g., due to a double-close bug elsewhere)
- **Expected Result**: `if (val < 0) await client.set(key, '0')` clamps the counter back to 0 — prevents a permanently negative counter that would silently allow unlimited over-concurrency (a negative count would never exceed `maxConcurrentTrades`).

#### TC-LSW-014: Redis failure during `reserveOpenSlot` fails closed (returns `false`, blocking the trade)
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate Redis unavailability during a `reserveOpenSlot` call
- **Expected Result**: Catch block returns `false` — the strategy treats a Redis error as "cannot reserve a slot," erring on the side of NOT opening a new position rather than silently allowing unlimited concurrency (contrast with `getOpenPositionCount`'s catch, which returns `Number.MAX_SAFE_INTEGER` — a deliberately different fail-safe direction for a read-only query vs. a mutating reservation).

### `short_quantity` Redis Representation Mismatch

#### TC-LSW-015: liquidity_sweep stores `short_quantity` as a plain string via `client.set`
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #66
- **Steps**: Trigger a SHORT entry (or a SELL/BUY-to-cover flow) that calls `setShortQuantityWithTagToRedis`; inspect the Redis key `short_quantity:<deploymentId>:<tag>` type
- **Expected Result** (current bug): Key is stored as a plain STRING type (`client.set(key, String(quantity))`) — confirmed via `TYPE short_quantity:<id>:<tag>` returning `string`, not `ReJSON-RL`.

#### TC-LSW-016: Attempting a RedisJSON `JSON.GET` on a liquidity_sweep short_quantity key throws `WRONGTYPE`
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #66
- **Steps**: After TC-LSW-015, run `JSON.GET short_quantity:<deploymentId>:<tag>` (as `account_utils.js`/msb_pts tooling would, expecting RedisJSON)
- **Expected Result** (current bug): Redis returns a `WRONGTYPE` error — any tooling built against the `account_utils.js` RedisJSON convention (used by msb_pts) is incompatible with keys written by liquidity_sweep's own `concurrency.js`, since both target the identical key naming pattern `short_quantity:${deploymentId}:${tag}` but with different underlying Redis types.

#### TC-LSW-017: Conversely, a plain `GET` on an `account_utils.js`-written (RedisJSON) short_quantity key fails
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #66
- **Steps**: If `account_utils.js`'s RedisJSON-based short-quantity writer is ever invoked for the same key namespace (e.g., in a future consolidation attempt or shared utility misuse), attempt a plain `GET`
- **Expected Result**: Plain `GET` on a RedisJSON key returns the raw JSON-encoded bytes (not a WRONGTYPE error in real Redis-stack behavior, but semantically wrong for direct integer parsing) or errors depending on Redis module version — document actual behavior; the core issue is that two code paths targeting the same key shape use incompatible serialization with no single source of truth.

### Sweep Signal Logging Integration

#### TC-LSW-018: `logSweepOutcome` posts to BackTestApp's `/deployments/:id/sweep-signals` with service-token auth
- **Category**: Functional
- **Priority**: P1
- **Steps**: Trigger a sweep outcome (success, filtered, or data-gap abort); verify the outbound HTTP call
- **Expected Result**: `SWEEP_LOG_API` + `/deployments/<id>/sweep-signals` called with `X-Service-Token: BACKTEST_SERVICE_TOKEN`, payload describing the sweep/outcome; matches `deploymentRoute.js`'s `authenticateOrServiceToken` acceptance for this route (see `BackTestApp-strategies-deployments.md` TC-DEP-047).

#### TC-LSW-019: Sweep log failure (network/API error) is caught and does not block strategy processing
- **Category**: Negative
- **Priority**: P2
- **Steps**: Point `SWEEP_LOG_API` at an unreachable endpoint; trigger a sweep outcome
- **Expected Result**: Logging failure is caught/logged internally; the main state machine transition still completes normally (logging is best-effort telemetry, not a blocking dependency).

### Order Execution & Sizing

#### TC-LSW-020: `tryExecuteEntry` respects `maxConcurrentTrades` gating before placing any order
- **Category**: Functional
- **Priority**: P0
- **Steps**: Force `reserveOpenSlot` to return `false` (at the limit); attempt entry
- **Expected Result**: No order is placed via `PLACEORDER_API`; `tryExecuteEntry` returns `{position:null, reason:...}` indicating the concurrency block, consistent with `LiquiditySweep.js`'s handling of a null position result (resets to IDLE).

#### TC-LSW-021: Filters (`passesFilters`) can reject a would-be-valid sweep signal before entry
- **Category**: Functional
- **Priority**: P1
- **Steps**: Construct a signal that fails a specific configured filter (e.g., volume threshold, time-of-day session filter)
- **Expected Result**: `attemptEntry` logs "Signal filtered: <reason>" and resets to `IDLE` without ever calling `tryExecuteEntry`/placing an order.

### Live vs Backtest Mode

#### TC-LSW-022: `IS_BACKTEST:"true"` env flag differentiates backtest-specific behaviors (e.g., OHLC source, timing)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Compare live vs. backtest deployment behavior for prior-day OHLC fetching and session-time handling
- **Expected Result**: Document and verify any backtest-specific branching driven by `IS_BACKTEST`/`strategy_mode` across `sessionInit.js`/`sessionTime.js` — confirm backtest runs use the deployment's `backtest_date` context rather than wall-clock "today."

#### TC-LSW-023: Backtest reset clears ALL liquidity_sweep runtime state including the account-scoped counter (cross-reference)
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #65
- **Steps**: See TC-LSW-012 and `BackTestApp-strategies-deployments.md` TC-DEP-028/TC-DEP-029 for the BackTestApp-side reset behavior driving this bug
- **Expected Result**: Cross-referenced — full detail lives in the deployment lifecycle test plan; this file focuses on the strategy-side consequence (corrupted concurrency tracking for co-located deployments).

#### TC-LSW-024: `checkIsTest()` is called but never defined — stale backtest message filter throws ReferenceError on every Kafka message
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Steps**: Start the `liquidity_sweep` strategy consumer (`kafka/services/Strategies/liquidity_sweep/server.js`); publish any valid Kafka message to `TARGET_TOPIC` with a symbol key and JSON payload containing `strategy_details` (with or without `backtest_run_id`)
- **Expected Result** (current bug): Line 70 calls `checkIsTest(strategy_details)`, but no such function exists in the module — only `resolveIsBackTest()` is defined (lines 39–44, reused later at line 91). Node throws `ReferenceError: checkIsTest is not defined` inside `eachMessage`, which is NOT caught by the inner per-message try/catch (that begins at line 76, after the failing call). Depending on KafkaJS error-handling configuration, this either crashes the consumer loop or causes every message to be dropped after an unhandled rejection — the stale `run_id` filter intended to discard out-of-date backtest ticks never executes. Fix expectation: replace line 70 with `resolveIsBackTest(strategy_details)` (or inline the same logic) so backtest run-id filtering works without aborting message processing.
