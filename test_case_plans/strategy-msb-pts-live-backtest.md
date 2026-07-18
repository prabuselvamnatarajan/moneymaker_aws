# Strategy: msb_pts (MSB with Points/Percent Target-SL) — Live & Backtest — Test Case Plan

## Scope
Covers the `msb_pts` strategy consumer (`kafka/services/Strategies/msb_pts`), an evolution of MSB that adds an explicit `position` object with configurable Target/Stop-Loss (points or percentage) exit logic evaluated BEFORE trend-break logic, and is nominally symmetric (LONG and SHORT) — but SHORT-opening is never actually implemented (issue #64). Deployed as `msb-pts-strategy` (live, `msb_pts_live_data`) and `msb-pts-strategy-backtest` (backtest, `msb_pts_backtest_data`).

## Prerequisites
- Same as MSB: Redis, `PLACEORDER_API` reachable, a RUNNING deployment with `advance_trade_decision`, `target_pts`/`sl_pts`/`target_type`/`target_pct`/`sl_pct` configured
- Ability to inject synthetic tick sequences to drive both the Target/SL check and the trend-break state machine independently

## Test Cases

### Initialization & State Shape

#### TC-MPT-001: Fresh state initializes with `position:null` and both `lastBuyPrice`/`lastSellPrice:null`
- **Category**: Functional
- **Priority**: P0
- **Steps**: First tick for a new deployment/symbol
- **Expected Result**: `{isUp:null, prevHigh, prevLow, lastBuyPrice:null, lastSellPrice:null, position:null, closedByTargetOrSl:false}`.

#### TC-MPT-002: Malformed/incomplete prior state (missing `prevHigh.high`) is treated as uninitialized
- **Category**: Regression (positive control for #62-style robustness)
- **Priority**: P1
- **Steps**: Manually seed Redis with a partial/corrupted state object missing `prevHigh.high`
- **Expected Result**: The defensive initialization guard (`!prevData || Object.keys(prevData).length===0 || !prevData.prevHigh || prevData.prevHigh.high===null/undefined || ...`) correctly detects this and re-initializes cleanly rather than crashing on destructure — contrast this robust multi-condition guard with the fragile single-condition `if (!prevData)` guard in plain MSB (issue #62); confirms msb_pts is NOT vulnerable to the `[]`-truthy crash in the same way (the guard explicitly checks internal shape, not just truthiness).

#### TC-MPT-003: Legacy state migration — old schema with `lastBuyPrice` but no `position` object is backfilled
- **Category**: Regression
- **Priority**: P2
- **Steps**: Seed a state object with `lastBuyPrice:100` but no `position` field (simulating state written by an older code version)
- **Expected Result**: `if (lastBuyPrice && !position) { position = {direction:"LONG", entryPrice:lastBuyPrice}; }` backfills a synthetic position object so Target/SL logic can still function post-upgrade.

### Target / Stop-Loss Exit Logic

#### TC-MPT-004: LONG position hits POINTS target — closes with SELL
- **Category**: Functional
- **Priority**: P0
- **Steps**: `advance_trade_decision:true, target_type:"POINTS", target_pts:50`; position LONG entry=100; tick LTP=150
- **Expected Result**: `targetHit = ltp >= entryPrice + target_pts` → true; SELL order fires; `position` reset to null; `setBoughtQuantityWithTagToRedis(symbol, 0, deploymentId)` clears bought-qty; `closedByTargetOrSl:true`.

#### TC-MPT-005: LONG position hits POINTS stop-loss — closes with SELL
- **Category**: Functional
- **Priority**: P0
- **Steps**: `sl_pts:30`; position LONG entry=100; tick LTP=69
- **Expected Result**: `slHit = ltp <= entryPrice - sl_pts` → true; SELL fires; same cleanup as target-hit.

#### TC-MPT-006: LONG position hits PERCENTAGE target/SL correctly
- **Category**: Functional
- **Priority**: P1
- **Steps**: `target_type:"PERCENTAGE", target_pct:2, sl_pct:1`; entry=100; test LTP=102 (target) and LTP=99 (SL) in separate scenarios
- **Expected Result**: `targetHit`/`slHit` computed via percentage formulas match hand-calculated boundary values exactly (test both just-above and just-below the threshold).

#### TC-MPT-007: SHORT position Target/SL directionality is inverted correctly (logic exists even though SHORT is never opened)
- **Category**: Functional / Regression
- **Priority**: P1
- **Related Issue**: #64
- **Steps**: Manually seed Redis state with `position:{direction:"SHORT", entryPrice:100}` (simulating a SHORT that could theoretically exist, e.g., from a future fix or manual state injection); tick LTP=50 (POINTS target reached for a short)
- **Expected Result**: `targetHit = ltp <= entryPrice - target_pts` evaluates correctly for SHORT; a BUY order fires to cover; confirms the exit-side logic is fully symmetric and correctly implemented — the bug is isolated entirely to the entry side (no code path ever sets `position.direction = "SHORT"` in normal operation).

#### TC-MPT-008: `advance_trade_decision:false` disables Target/SL checking entirely
- **Category**: Functional
- **Priority**: P1
- **Steps**: Deploy with `advance_trade_decision:false` (or a strategy that was never configured for advanced mode, defaulting per `services/strategy.js#createStrategy`); position is deep in profit past what would be a target
- **Expected Result**: `if (advance_trade_decision && position)` guard skips Target/SL evaluation entirely — position only closes via trend-break logic, never via points/percentage target, consistent with the simple (non-advanced) strategy configuration.

#### TC-MPT-009: `closedByTargetOrSl` flag prevents a duplicate exit order on the same trend-break tick
- **Category**: Regression
- **Priority**: P0
- **Steps**: Construct a tick where Target/SL closes the LONG position AND, on the SAME tick, the trend also breaks down (both conditions true simultaneously)
- **Expected Result**: The Target/SL block runs first, sets `closedByTargetOrSl:true` and `position:null`; the subsequent trend-break-down block sees `closedByTargetOrSl` is true, logs "Skip duplicate exit order for LONG. Position already closed by Target/SL," resets the flag, and does NOT fire a second SELL order — prevents double-closing/duplicate order on a single tick where both exit conditions coincide.

### Trend Establishment & Breaks — LONG Side (Working)

#### TC-MPT-010: Initial trend establishment UP opens a LONG
- **Category**: Functional
- **Priority**: P0
- **Steps**: `isUp:null` (fresh state); tick where `high > prevLow.high`
- **Expected Result**: `isUp→true`; BUY order fires; `position:{direction:"LONG", entryPrice:ltp}`; `lastBuyPrice` set.

#### TC-MPT-011: Uptrend break DOWN closes the LONG (if not already closed by Target/SL)
- **Category**: Functional
- **Priority**: P0
- **Steps**: `isUp:true`; tick breaks `prevHigh.low`
- **Expected Result**: `isUp→false`; if `position.direction==="LONG"` and not already closed, SELL fires; `position:null`.

#### TC-MPT-012: Downtrend break UP closes any SHORT (dead code, never triggered) AND opens a fresh LONG
- **Category**: Functional
- **Priority**: P0
- **Steps**: `isUp:false`; tick breaks `prevLow.high`
- **Expected Result**: `isUp→true`; the `position.direction==="SHORT"` branch is skipped (position is always null here, per #064); a NEW LONG BUY order fires unconditionally right after — confirms every up-break, regardless of prior state, opens a LONG (never a SHORT close+reopen, since SHORT never exists).

### SHORT Never Opens (Core Regression)

#### TC-MPT-013: Initial trend establishment DOWN opens NO position at all
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #64
- **Steps**: `isUp:null` (fresh state); tick where `prevHigh.low > low` (establishes downtrend) and NOT the up-break condition
- **Expected Result** (current bug): `isUp→false`; `prevLow` updated; NO `computeOrderPayload(..., "SELL", ...)` call is made to open a SHORT position — the code only logs "Established initial trend DOWN" and updates trackers. `position` remains `null`. The strategy misses what should symmetrically be a SHORT entry signal.

#### TC-MPT-014: Uptrend break DOWN closes any existing LONG but opens NO fresh SHORT
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #64
- **Steps**: `isUp:true, position:{direction:"LONG",...}`; tick breaks `prevHigh.low` (trend break down)
- **Expected Result** (current bug): Existing LONG is correctly closed (SELL fires, per TC-MPT-011). However, after closing, the code does NOT call `computeOrderPayload(..., "SELL", ...)` a second time to OPEN a fresh SHORT position at the break — unlike the symmetric up-break case (TC-MPT-012) which DOES open a fresh LONG immediately after any close. This confirms the strategy is silently long-only in practice: half of the intended trend-following signals (every down-break) never generate a new trade, only a close.

#### TC-MPT-015: `getShortQuantityWithTagFromRedis`/`setShortQuantityWithTagToRedis` plumbing exists but is permanently dead code in normal operation
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #64
- **Steps**: Audit `computeOrderPayload`'s SHORT-quantity helper usage — it's fully wired to check `getShortQuantityWithTagFromRedis` when computing BUY-to-cover quantities
- **Expected Result**: Since `position.direction` is never set to `"SHORT"` anywhere in `MSB.js`'s entry logic, the SHORT-quantity Redis key (`short_quantity:<deploymentId>:<tag>`) is never written by this strategy in live operation — verify it stays permanently at its default (0 / unset), confirming the cover-quantity logic, while correctly implemented, is unreachable dead code given the current entry-side bug.

### Order Sizing (Full-Amount Mode)

#### TC-MPT-016: `use_full_amount` BUY correctly distinguishes "opening LONG" vs "covering SHORT" via `getShortQuantityWithTagFromRedis`
- **Category**: Functional
- **Priority**: P1
- **Steps**: Manually seed a nonzero short-quantity Redis key (simulating a hypothetical future-fixed SHORT), then trigger a BUY signal with `use_full_amount:true`
- **Expected Result**: `computeOrderPayload` correctly detects `shortQty > 0` and uses it as the covering quantity rather than recomputing a fresh full-balance LONG size — validates the (currently dead) covering-logic branch works correctly in isolation, useful as a regression test to keep passing once issue #64 is fixed and SHORT-opening is wired up.

#### TC-MPT-017: `use_full_amount:false` SELL correctly exits using the tracked bought-quantity, not a fixed default
- **Category**: Functional
- **Priority**: P1
- **Steps**: `use_full_amount:false`, `quantity:1` (default) in `strategy_details`; a bought-quantity of 25 was tracked earlier for this tag/deployment; trigger a SELL close
- **Expected Result**: `computeOrderPayload`'s non-full-amount branch still overrides the default `quantity` with `getBoughtQuantityWithTagFromRedis` when a nonzero bought-quantity exists — the position is closed in full (25), not partially (1), even in "not use_full_amount" mode.

### deployment_id Namespacing & Reset

#### TC-MPT-018: Redis state and quantity keys are correctly namespaced by `deployment_id`
- **Category**: Functional
- **Priority**: P0
- **Related Issue**: #48
- **Steps**: Two deployments run msb_pts on the same symbol concurrently
- **Expected Result**: Independent `strategies:msb_pts:<mode>:<deploymentId>:<symbol>` state keys and independent `bought_quantity:*:<deploymentId>` / short-quantity keys — no cross-deployment interference.

#### TC-MPT-019: Backtest reset via BackTestApp SCAN+DEL clears all msb_pts keys for the deployment, including `position`/Target-SL state
- **Category**: Functional
- **Priority**: P1
- **Steps**: Restart a BACKTEST msb_pts deployment
- **Expected Result**: Full state (including the richer `position`/`closedByTargetOrSl` fields unique to this strategy) is wiped and reinitializes cleanly from `isUp:null` on the next tick.
