# Strategy: MSB (Market Structure Break) — Live & Backtest — Test Case Plan

## Scope
Covers the `MSB` strategy consumer (`kafka/services/Strategies/MSB`), deployed twice: `msb-strategy` (live, topic `msb_live_data`) and `msb-strategy-backtest` (backtest, topic `msb_backtest_data`). Core logic tracks a swing-high/swing-low trend state machine per symbol (long-only: opens LONG on up-break, closes on down-break — never shorts) and calls `PLACEORDER_API` to execute orders. State persisted in Redis, namespaced by `deployment_id`.

## Prerequisites
- Redis reachable; `placeorder` service (or a mock) reachable at `PLACEORDER_API`
- A RUNNING deployment using the `MSB` strategy, LIVE or BACKTEST mode, with `account_id`, `instrument_token`, target lot size, etc. synced into `strategy_details`
- Ability to inject synthetic OHLC+LTP tick sequences to drive the trend state machine deterministically

## Test Cases

### State Machine — Trend Tracking

#### TC-MSB-001: First-ever tick for a (symbol, deployment) initializes state with `isUp:null`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Send the first tick `{high:100, low:95}` for a fresh deployment/symbol pair
- **Expected Result**: `getMSBStrategyStateForSymbol` returns `null` (no key yet); `MSB(null, currentData, ...)` returns `{isUp:null, prevHigh:{high:100,low:95}, prevLow:{high:100,low:95}}` with NO order placed.

#### TC-MSB-002: Uptrend continuation raises `prevHigh` without triggering an order
- **Category**: Functional
- **Priority**: P1
- **Steps**: With `isUp:true` and `prevHigh:{high:100,low:95}`, send a tick `{high:105, low:98}` (higher high, no break below `prevHigh.low`)
- **Expected Result**: `prevHigh` updates to `{high:105, low:98}`; `isUp` remains `true`; no order.

#### TC-MSB-003: Uptrend break (low breaches prevHigh.low) closes the LONG with a SELL
- **Category**: Functional
- **Priority**: P0
- **Steps**: With `isUp:true, prevHigh:{high:105,low:98}`, send a tick with `low:97` (< 98)
- **Expected Result**: `isUp` flips to `false`; `prevLow` set from current tick; a SELL order payload is computed via `computeOrderPayload` and `triggerOrder` called (assuming resulting quantity > 0).

#### TC-MSB-004: Downtrend break (high breaches prevLow.high) opens a LONG with a BUY
- **Category**: Functional
- **Priority**: P0
- **Steps**: With `isUp:false, prevLow:{high:98,low:90}`, send a tick with `high:99` (> 98)
- **Expected Result**: `isUp` flips to `true`; `prevHigh` set from current tick; a BUY order fires; on success, `setBoughtQuantityWithTagToRedis(symbol, quantity, deployment_id)` records the bought quantity for later exit sizing.

#### TC-MSB-005: Downtrend continuation lowers `prevLow` without ordering
- **Category**: Functional
- **Priority**: P1
- **Steps**: `isUp:false`; send a tick with a new lower low that doesn't break `prevHigh.low`
- **Expected Result**: `prevLow` updates; no order fires.

#### TC-MSB-006: MSB is structurally long-only — never opens a SHORT position
- **Category**: Regression (documentation of design, not necessarily a bug like #64 in msb_pts)
- **Priority**: P2
- **Steps**: Audit all branches of `MSB()` for any `computeOrderPayload(..., "SELL", ...)` call that is NOT a close-of-long
- **Expected Result**: Confirmed — the only SELL call closes an existing long on downtrend break; the only BUY call opens a long on uptrend break. There is no SHORT-opening path in this strategy at all (contrast with `msb_pts`, which is nominally symmetric but has issue #64; MSB is long-only by design, not by bug).

### Redis `[]` vs `null` Crash (Critical Bug)

#### TC-MSB-007: Transient Redis GET failure returns `[]` from the inner catch, causing a fatal crash
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #62
- **Steps**: Simulate a transient Redis error specifically on the `redisJson.getJson(redisKey)` call inside `getMSBStrategyStateForSymbol`'s try/catch (e.g., a single connection blip), for a deployment that has prior valid state
- **Expected Result** (current bug): The INNER catch returns `[]` (not `null`). Back in `MSB.js`, the check is `if (!prevData)` — since `[]` is truthy in JavaScript, this check is FALSE, so the code proceeds to destructure `let { isUp, prevHigh, prevLow } = prevData;` off an empty array, yielding `undefined` for all three. The subsequent `if (isUp)` branch evaluates falsy → goes to the `else` (downtrend) branch → accesses `prevLow.high` on `undefined` → throws `TypeError: Cannot read properties of undefined (reading 'high')`. This propagates uncaught to `handleFatalError`, terminating the entire MSB consumer process for ALL symbols/deployments it's handling, not just the one that hit the transient Redis error.
- **Notes**: This is THE highest-priority regression test for this strategy — a single Redis network blip is a routine, expected occurrence, and this bug converts it into a full strategy-container crash/restart loop under any Redis instability. Verify the outer catch (which correctly returns `null`) is never reached because the inner try/catch swallows the error first.

#### TC-MSB-008: Outer catch path (both Redis client init and JSON fetch throw) correctly returns `null`
- **Category**: Regression (positive control)
- **Priority**: P1
- **Related Issue**: #62
- **Steps**: Simulate a failure BEFORE the inner try block — e.g., `redisClientInstance.connect()` itself throws (outer try/catch scope)
- **Expected Result**: Outer catch returns `null` correctly; `MSB.js`'s `if (!prevData)` correctly treats this as "no state" and initializes fresh — no crash. Confirms the bug is specific to the INNER catch's `[]` return, not the outer one.

#### TC-MSB-009: Crash-loop recovery — after restart, state re-initializes from a truly missing key
- **Category**: Negative
- **Priority**: P1
- **Steps**: After the crash in TC-MSB-007, Swarm restarts the container; the Redis key from before the crash may or may not still exist
- **Expected Result**: If the key exists (state was written successfully before the crash), next tick correctly resumes from stored state; if lost, initializes fresh — verify no permanently corrupted state (e.g., a partially-written key) causes a repeat crash loop.

### Order Payload / Zero-Quantity Guards

#### TC-MSB-010: `computeOrderPayload` with `use_full_amount:true` sizes BUY quantity from account balance
- **Category**: Functional
- **Priority**: P0
- **Steps**: Trigger a BUY signal with `use_full_amount:true`, `commission_type:"PERCENTAGE", commission_rate:0.1`, a known Redis-cached account balance, and `lot_size` set
- **Expected Result**: `quantity = floor(maxAffordableValue / (ltp*lot_size)) * lot_size`, where `maxAffordableValue` accounts for commission and a 0.05 safety buffer; matches hand-calculated value.

#### TC-MSB-011: Zero-quantity BUY (insufficient balance) is skipped, no order placed
- **Category**: Negative
- **Priority**: P0
- **Steps**: Account balance too low to afford even 1 unit at current LTP; trigger the uptrend-break BUY signal
- **Expected Result**: Computed `quantity` is 0; `MSB.js`'s guard `if (requestBody && requestBody.quantity > 0)` prevents `triggerOrder` from firing; a warning is logged ("Skipping BUY order due to zero/negative quantity"); `setBoughtQuantityWithTagToRedis` is also NOT called in this path (only called inside the `if` block) — confirms no bought-quantity is falsely recorded when no order was actually placed.

#### TC-MSB-012: `triggerOrder` itself also guards against zero/negative quantity as defense-in-depth
- **Category**: Negative
- **Priority**: P2
- **Steps**: Directly invoke `triggerOrder` with a payload where `quantity <= 0` (bypassing the caller's own guard, hypothetically)
- **Expected Result**: `triggerOrder`'s own internal check (`if (!requestBody || requestBody.quantity <= 0)`) logs a warning and returns without calling `PLACEORDER_API` — double-layered protection against zero/negative order quantities.

#### TC-MSB-013: SELL (close-long) with zero remaining bought-quantity is skipped
- **Category**: Negative
- **Priority**: P1
- **Steps**: `use_full_amount:true`; downtrend break fires when `getBoughtQuantityWithTagFromRedis` returns 0 (e.g., double-processed close, or state desync)
- **Expected Result**: SELL quantity resolves to 0; order skipped with a warning; no erroneous SELL order for a nonexistent position.

#### TC-MSB-014: Missing `PLACEORDER_API` env var logs an error and never calls the API
- **Category**: Negative
- **Priority**: P2
- **Steps**: Unset `PLACEORDER_API`; trigger any order signal
- **Expected Result**: `triggerOrder` logs "PLACEORDER_API env variable not set" and exits without an HTTP call; strategy processing otherwise continues without crashing.

#### TC-MSB-015: `placeorder` API call failure (network error / non-2xx) is caught and logged, does not crash the consumer
- **Category**: Negative
- **Priority**: P1
- **Steps**: Point `PLACEORDER_API` at an unreachable/erroring endpoint; trigger an order signal
- **Expected Result**: `axios.post` rejection caught inside `triggerOrder`'s try/catch, logged ("Order API error"); the MSB consumer's `eachMessage` handling continues processing subsequent ticks without crashing (contrast with the fatal-crash behavior of TC-MSB-007, which happens OUTSIDE this specific try/catch).

### Price / Order Type Semantics

#### TC-MSB-016: MARKET order in LIVE mode sends `price:0` to the broker
- **Category**: Functional
- **Priority**: P1
- **Steps**: `strategy_mode:"LIVE"`, `order_type:"MARKET"` (default); trigger a BUY
- **Expected Result**: `orderPayLoad.price === 0` since `isLive && order_type==="MARKET"` — broker fills at market price; contrast with LIMIT orders or PAPER/BACKTEST mode which use `ltp` directly as price.

#### TC-MSB-017: PAPER/BACKTEST mode always uses `ltp` as price regardless of order type
- **Category**: Functional
- **Priority**: P1
- **Steps**: `strategy_mode:"PAPER"` or backtest tick with `isTest:true`; trigger a BUY
- **Expected Result**: `isLive` evaluates false (`strategy_mode !== 'LIVE' && isTest !== false`), so `price = ltp` — simulated fills always execute at the tick's LTP.

#### TC-MSB-018: Order `tag` is sanitized to alphanumeric/underscore/hyphen only
- **Category**: Functional
- **Priority**: P2
- **Steps**: `symbol` (used as `tag`) contains special characters (unlikely in practice, but verify defensively, e.g., a symbol with a colon or slash)
- **Expected Result**: `tag.replace(/[^a-zA-Z0-9_-]/g, "_")` sanitizes before use — safe for downstream Redis key construction and broker tag fields.

### deployment_id Namespacing

#### TC-MSB-019: Redis state key is namespaced by `deployment_id` when present
- **Category**: Functional
- **Priority**: P0
- **Related Issue**: #48
- **Steps**: Two different deployments run MSB on the SAME symbol concurrently (e.g., two accounts both trading RELIANCE); verify each has an independent `strategies:msb:<mode>:<deploymentId>:<symbol>` Redis key
- **Expected Result**: State evolves independently per deployment — no cross-contamination of trend state between the two deployments trading the same underlying symbol.

#### TC-MSB-020: Fallback to non-namespaced key when `deployment_id` is absent (dead-code path, latent risk)
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #48
- **Steps**: Manually invoke the strategy runner path with `strategy_details.deployment_id` unset/undefined (simulating a caller bug or legacy code path)
- **Expected Result** (latent risk): `getRedisKey` falls back to `strategies:msb:<mode>:<symbol>` with no deployment scoping — if two deployments both somehow omitted `deployment_id`, they would collide on the same global key. Confirm this fallback branch is genuinely unreachable in the current `syncAllDeploymentsToRedis`-driven flow (which always injects `deployment_id`), and flag it as dead-code risk per the issue.

#### TC-MSB-021: `resetBacktestDeployment`'s SCAN+DEL by deployment ID correctly clears ALL of this strategy's keys for that deployment
- **Category**: Functional
- **Priority**: P1
- **Steps**: Reset a BACKTEST MSB deployment via BackTestApp's lifecycle `start`/`restart`; verify Redis state
- **Expected Result**: The `strategies:msb:backtest:<deploymentId>:<symbol>` key (and any `bought_quantity:*:<deploymentId>` / similar keys) are deleted by the SCAN-based cleanup in `deployment.js`'s `resetBacktestDeployment`, ensuring the next run starts from a clean `isUp:null` state.

### Backtest Completion Signal

#### TC-MSB-022: `setBacktestCompleted` writes a TTL'd Redis flag when a backtest run finishes
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trigger whatever end-of-backtest condition invokes `setBacktestCompleted(deploymentId)` (verify the calling site — likely on stream-exhaustion or explicit completion signal from `msb-strategy-backtest`'s server.js)
- **Expected Result**: `backtest_completed:<deploymentId>` key set to `'true'` with a 120s expiry — sufficient for any polling consumer to detect completion shortly after the run ends, then auto-cleans itself up.

### Live vs Backtest Mode Isolation

#### TC-MSB-023: Live and backtest instances of MSB consume from distinct topics and never cross-process each other's ticks
- **Category**: Functional
- **Priority**: P1
- **Steps**: Verify `msb-strategy` subscribes only to `msb_live_data` and `msb-strategy-backtest` only to `msb_backtest_data` per compose env
- **Expected Result**: Complete topic-level isolation; a tick produced for one never reaches the other's consumer group, preventing accidental live/backtest state or order-mode mixing at the transport layer (mode-correctness within a single consumer still depends on `isTest`/`strategy_mode` fields carried in the message itself, per TC-MSB-016/017).
