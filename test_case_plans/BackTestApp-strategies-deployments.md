# BackTestApp — Strategies & Deployments — Test Case Plan

## Scope
Covers `Strategy` template CRUD (`/api/strategies`) and `Deployment` lifecycle (`/api/deployments`): creation, advanced/simple trade-decision modes, symbol association (including dynamic `symbol_control` option resolution), lifecycle transitions (start/stop/pause/resume/restart), backtest triggering/reset, metrics/analysis reporting, and Redis synchronization. All endpoints require `authenticate` except `resolve-symbol` (service-token only) and `sweep-signals` (auth OR service token).

## Prerequisites
- Authenticated user with at least one `Account` (PAPER or LIVE) and one active `UserSymbol`
- A `Strategy` template created for use in deployments
- Redis reachable (deployment sync writes `strategies:live:*`/`strategies:backtest:*` keys)
- For symbol_control tests: an underlying `UserSymbol` with `instrument_class` ≠ `OPTION` and `strike_price_diff > 0`
- A second user account for IDOR/ownership tests

## Test Cases

### Strategy — Create

#### TC-STR-001: Create basic strategy defaults advanced fields when `advance_trade_decision` is falsy
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/strategies` with `{strategy_name, strategy_description}` and no `advance_trade_decision`
- **Expected Result**: Saved strategy has `target_pts:500, sl_pts:500, target_type:"POINTS", target_pct:2, sl_pct:2, advance_trade_decision:false` regardless of any conflicting values supplied.

#### TC-STR-002: Create advanced strategy preserves client-supplied target/SL fields
- **Category**: Functional
- **Priority**: P1
- **Steps**: `POST /api/strategies` with `advance_trade_decision:true, target_pts:1000, sl_pts:300, target_type:"PERCENT", target_pct:5, sl_pct:1.5`
- **Expected Result**: All supplied advanced fields persisted as-is (defaults not applied since `advance_trade_decision` is truthy).

#### TC-STR-003: Strategy created is scoped to creating user
- **Category**: Security
- **Priority**: P1
- **Steps**: Create strategy as User A; fetch as User B via `GET /api/strategies/:id`
- **Expected Result**: User B's request is scoped to `user_id: userB` and does not find User A's strategy (404).

### Strategy — Read/List

#### TC-STR-004: List strategies scoped to caller only (non-admin)
- **Category**: Security
- **Priority**: P0
- **Steps**: `GET /api/strategies` as User B while User A has strategies
- **Expected Result**: Only User B's strategies returned.

#### TC-STR-005: Search strategies by `strategy_name`/`strategy_description` ReDoS risk
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #43
- **Steps**: `GET /api/strategies?search=<catastrophic backtracking pattern>`
- **Expected Result** (bug): Unescaped regex construction can hang the event loop.

### Strategy — Update

#### TC-STR-006: Update whitelist enforced for non-admin
- **Category**: Functional
- **Priority**: P1
- **Steps**: `PATCH /api/strategies/:id` with an allowed field (`strategy_name`) and a disallowed one (`user_id`)
- **Expected Result**: Only `strategy_name` changes; `user_id` change ignored.

#### TC-STR-007: Setting `advance_trade_decision:false` on update resets target/SL fields to defaults
- **Category**: Functional
- **Priority**: P1
- **Steps**: Strategy currently has `advance_trade_decision:true, target_pts:1000`; `PATCH` with `{advance_trade_decision:false}`
- **Expected Result**: `target_pts`/`sl_pts`/`target_type`/`target_pct`/`sl_pct` are forcibly reset to defaults (500/500/POINTS/2/2), overriding any prior custom advanced values.

#### TC-STR-008: Update with zero valid fields rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `PATCH /api/strategies/:id` with `{}`
- **Expected Result**: "No valid fields provided for update" error.

#### TC-STR-009: Update another user's strategy blocked (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B attempts `PATCH` on User A's strategy id
- **Expected Result**: Scoped query finds nothing; 404/no-op.

### Strategy — Delete & Cascade

#### TC-STR-010: Deleting a strategy cascades to its deployments and all child trades/positions/ledgers
- **Category**: Functional
- **Priority**: P0
- **Steps**: Create strategy → deployment(s) → trades/positions/ledger entries; `DELETE /api/strategies/:id`
- **Expected Result**: All deployments referencing the strategy deleted; all linked trades/positions/ledgers (via deployment_id or directly) deleted; strategy removed; Redis deployment sync invoked afterward.

#### TC-STR-011: Deleting a strategy with active RUNNING deployments does not block deletion
- **Category**: Negative
- **Priority**: P1
- **Steps**: Strategy has a deployment in `RUNNING` status; delete the strategy
- **Expected Result**: Deletion proceeds regardless of deployment status (no guard against deleting in-flight live/paper deployments) — flag as a potential safety gap for LIVE deployments actively trading.

### Deployment — Create (Symbol Association & Validation)

#### TC-DEP-001: Create deployment with a plain `user_symbol_id` (no symbol_control)
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/deployments` with `{strategy_id, account_id, user_symbol_id, instrument_token, symbol, start_time, current_status:"SCHEDULED", strategy_mode:"PAPER"}`
- **Expected Result**: Deployment created; `symbol_control.enabled` defaults to false.

#### TC-DEP-002: Create deployment with missing `user_symbol_id` and no `symbol_control` rejected
- **Category**: Negative
- **Priority**: P0
- **Steps**: `POST /api/deployments` omitting `user_symbol_id` and `symbol_control`
- **Expected Result**: "user_symbol_id is required (or enable symbol_control to auto-resolve)" error.

#### TC-DEP-003: Create deployment referencing an inactive `UserSymbol` rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `user_symbol_id` points to a symbol with `is_active:false`
- **Expected Result**: "Cannot associate an inactive symbol to deployment" error.

#### TC-DEP-004: Create deployment referencing another user's symbol rejected
- **Category**: Security
- **Priority**: P0
- **Steps**: `user_symbol_id` belongs to a different user
- **Expected Result**: Lookup scoped by `{_id, user_id: userId}` finds nothing → "Associated symbol not found" error.

#### TC-DEP-005: IDOR — `createDeployment` does not verify `strategy_id` ownership
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #42
- **Steps**: User A knows User B's `strategy_id` (e.g., leaked/enumerated); User A `POST /api/deployments` with that `strategy_id` and their own `account_id`/`user_symbol_id`
- **Expected Result** (current bug): Deployment is created successfully referencing User B's strategy — no ownership check exists for `strategy_id`, exposing proprietary strategy config (target/SL/advanced params) to User A's runtime via Redis sync.

#### TC-DEP-006: IDOR — `createDeployment` does not verify `account_id` ownership
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #42
- **Steps**: User A supplies a foreign `account_id` (belonging to User B) alongside their own `strategy_id`/`user_symbol_id`
- **Expected Result** (current bug): Deployment saved with a foreign `account_id` reference — no `Account.findOne({_id, user_id})` check exists — creating inconsistent cross-user deployment records; subsequent Redis sync (`syncAllDeploymentsToRedis`) would attribute trading activity to User B's account balance.

#### TC-DEP-007: Duplicate active deployment for same (strategy, account, instrument_token) rejected by unique index
- **Category**: Negative
- **Priority**: P1
- **Steps**: Create a `RUNNING` or `SCHEDULED` deployment for (strategy X, account Y, token Z); attempt to create a second one with identical triple while the first remains RUNNING/SCHEDULED
- **Expected Result**: Mongo duplicate-key error from the partial unique index; second creation rejected.

#### TC-DEP-008: Same (strategy, account, instrument_token) allowed again after first deployment is STOPPED/COMPLETED
- **Category**: Functional
- **Priority**: P2
- **Steps**: Stop the first deployment (status → STOPPED); create a second deployment with the same triple
- **Expected Result**: Succeeds — partial index only applies to `RUNNING`/`SCHEDULED` statuses.

#### TC-DEP-009: `end_time` before `start_time` rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `POST /api/deployments` with `end_time` earlier than `start_time`
- **Expected Result**: "end_time must be after start_time" validation error.

#### TC-DEP-010: Invalid `strategy_mode` enum rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `strategy_mode: "DEMO"`
- **Expected Result**: Schema enum validation error (only LIVE/PAPER/BACKTEST allowed).

### Deployment — Default UI Safety Gap (frontend, cross-referenced)

#### TC-DEP-011: Deploy dialog defaults to LIVE mode + active status (regression guard)
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #33
- **Steps**: In BackTestUI, open "Deploy Strategy" dialog without touching the Mode dropdown or Initial Status field; submit
- **Expected Result** (current bug): Request is submitted with `strategy_mode:"LIVE"` and `current_status`/initial status `"active"`/`RUNNING`-equivalent by default — a user who fills only the required fields deploys real-money live trading unintentionally.
- **Notes**: Backend accepts whatever `strategy_mode` is sent; this is a UI-default defect, not a backend validation gap — tracked here for cross-reference; full UI flow test lives in `BackTestUI.md`.

### Deployment — symbol_control (Dynamic Option Resolution)

#### TC-DEP-012: Create with `symbol_control.enabled:true` auto-resolves option symbol on creation
- **Category**: Functional
- **Priority**: P1
- **Steps**: `POST /api/deployments` with `symbol_control:{enabled:true, underlying_user_symbol_id, moneyness:"ITM", offset:1, option_type:"CE", expiry:"2026-12-25"}`, omitting `user_symbol_id`/`instrument_token`/`symbol` directly
- **Expected Result**: Service resolves the underlying to a live option contract, sets `user_symbol_id`/`instrument_token`/`symbol` to the resolved option, and stores `last_resolved_strike`/`last_resolved_at`.

#### TC-DEP-013: symbol_control rejects underlying that is itself an OPTION UserSymbol
- **Category**: Negative
- **Priority**: P2
- **Steps**: Set `underlying_user_symbol_id` to a symbol whose `instrument_class` is `OPTION`
- **Expected Result**: "symbol_control underlying cannot be an OPTION UserSymbol" error.

#### TC-DEP-014: symbol_control rejects underlying without positive `strike_price_diff`
- **Category**: Negative
- **Priority**: P2
- **Steps**: Underlying has `strike_price_diff: 0` or missing
- **Expected Result**: "Underlying symbol must have strike_price_diff > 0" error.

#### TC-DEP-015: symbol_control rejects malformed `expiry` (not YYYY-MM-DD)
- **Category**: Negative
- **Priority**: P2
- **Steps**: `expiry: "25-12-2026"` or `"2026-13-45"`
- **Expected Result**: Regex/calendar validation error ("must be a date in YYYY-MM-DD format" or "not a valid calendar date").

#### TC-DEP-016: symbol_control missing `underlying_user_symbol_id` when enabled rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `symbol_control:{enabled:true}` with no `underlying_user_symbol_id`
- **Expected Result**: Explicit error requiring the field.

#### TC-DEP-017: Re-resolve deferred when an open position exists
- **Category**: Functional
- **Priority**: P1
- **Steps**: Deployment has `symbol_control.enabled`, an OPEN position exists (via `Position` doc or nonzero cached `position_size`); trigger resolve (e.g., via strike movement webhook / manual `resolve-symbol` call with service token, or via lifecycle transition)
- **Expected Result**: `pending_resolve` is set to `true`; no symbol remap occurs while a position is open; response indicates `deferred:true, reason:"open_position"`.

#### TC-DEP-018: Resolve conflicts with another active deployment already on the target token
- **Category**: Negative
- **Priority**: P2
- **Steps**: Two deployments share `strategy_id`+`account_id`; one is already RUNNING on the resolved target `instrument_token`; trigger resolve on the second
- **Expected Result**: "Cannot remap: active deployment ... already uses ..." error thrown; no remap applied.

#### TC-DEP-019: Resolve is a no-op when target token and strike are unchanged
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trigger resolve when the resolved option/strike matches current state exactly
- **Expected Result**: `unchanged:true` returned; `pending_resolve` cleared; no Redis key migration triggered.

#### TC-DEP-020: `/resolve-symbol` endpoint requires service token (not user JWT)
- **Category**: Security
- **Priority**: P1
- **Steps**: `POST /api/deployments/:id/resolve-symbol` with a valid user JWT but no `X-Service-Token`, then again with the service token
- **Expected Result**: JWT-only request rejected by `requireServiceToken`; service-token request succeeds.

#### TC-DEP-021: Redis key migration on symbol remap renames deployment-scoped keys
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trigger a symbol remap that changes `instrument_token`; inspect Redis keys containing the deployment ID and old symbol
- **Expected Result**: Keys are renamed (`RENAME`) from old-symbol to new-symbol variants via SCAN+RENAME, preserving strategy runtime state across the remap.

### Deployment — Lifecycle Transitions

#### TC-DEP-022: Valid transition SCHEDULED → start → RUNNING
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/deployments/:id/start` on a SCHEDULED deployment
- **Expected Result**: `current_status` becomes RUNNING; `start_time` updated to now; `end_time` cleared.

#### TC-DEP-023: Invalid transition rejected — e.g., `start` on already-RUNNING deployment
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/deployments/:id/start` when status is already RUNNING
- **Expected Result**: "Cannot start deployment in status 'RUNNING'. Allowed from: SCHEDULED, STOPPED, COMPLETED" error.

#### TC-DEP-024: `stop` only valid from RUNNING or PAUSED
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/deployments/:id/stop` on a SCHEDULED deployment
- **Expected Result**: Transition rejected with allowed-states message.

#### TC-DEP-025: `pause` only valid from RUNNING; `resume` only valid from PAUSED
- **Category**: Functional
- **Priority**: P1
- **Steps**: Exercise pause from RUNNING (should succeed) and from STOPPED (should fail); resume from PAUSED (succeed) and from RUNNING (fail)
- **Expected Result**: Matches `VALID_TRANSITIONS` map exactly.

#### TC-DEP-026: `restart` allowed from RUNNING, PAUSED, STOPPED, or COMPLETED
- **Category**: Functional
- **Priority**: P2
- **Steps**: Exercise `restart` from each of the four allowed states
- **Expected Result**: All succeed, transitioning to RUNNING with `start_time` reset and `end_time` cleared.

#### TC-DEP-027: `start`/`restart` on a BACKTEST-mode deployment resets trades/ledgers/positions and account balance
- **Category**: Functional
- **Priority**: P0
- **Steps**: BACKTEST deployment has existing trades/positions/ledger entries and a modified account balance; call `start` or `restart`
- **Expected Result**: `resetBacktestDeployment` deletes all trades/ledgers/positions for the deployment, resets `position_size`/`average_entry_price` to 0, resets the linked account's `current_balance` back to `initial_balance`, and syncs the reset balance to Redis (`account_balance:<id>` key); also deletes `liquidity_sweep:open:<accountId>` Redis key.

#### TC-DEP-028: Backtest reset shared-counter side effect on other deployments (cross-reference)
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #65
- **Steps**: Two different `liquidity_sweep` deployments share the same `account_id`; `start`/`restart` one of them while the other has open positions counted in `liquidity_sweep:open:<accountId>`
- **Expected Result** (bug): Resetting deployment A wipes the shared per-account Redis counter used by deployment B too, corrupting B's concurrency tracking. Full detail in `strategy-liquidity-sweep-live-backtest.md`.

#### TC-DEP-029: `start`/`restart` on LIVE/PAPER (non-BACKTEST) triggers liquidity_sweep runtime reset instead
- **Category**: Functional
- **Priority**: P1
- **Steps**: Deployment uses `liquidity_sweep` strategy with `strategy_mode != "BACKTEST"`; call `start`
- **Expected Result**: `resetLiquiditySweepRuntimeState` runs (not `resetBacktestDeployment`'s trade/ledger wipe) — decrements shared open-counter if a stale IN_POSITION state existed, deletes deployment-scoped strategy-state keys.

#### TC-DEP-030: `start`/`restart`/`resume` on LIVE/PAPER auto-activates an inactive associated symbol and (re)subscribes it
- **Category**: Functional
- **Priority**: P1
- **Steps**: Deployment's `user_symbol_id` points to a `UserSymbol` with `is_active:false`; call `start`
- **Expected Result**: Symbol is auto-flipped to `is_active:true`; `publishSymbolUpdate({action:"subscribe", instrument_token, userId})` is invoked.

#### TC-DEP-031: `start`/`restart`/`resume` with `symbol_control.enabled` triggers a fresh resolve attempt
- **Category**: Functional
- **Priority**: P1
- **Steps**: symbol_control-enabled deployment is flat (no open position); call `resume`
- **Expected Result**: `resolveDeploymentSymbol(id, {force:false})` is invoked; on success the returned deployment reflects any remap; on failure `symbol_control.last_resolve_error` is persisted but the lifecycle transition itself still completes.

#### TC-DEP-032: BACKTEST-mode deployment transitioning to RUNNING triggers backtest-client HTTP call
- **Category**: Functional
- **Priority**: P0
- **Steps**: BACKTEST deployment transitions to RUNNING via `start`; capture outbound HTTP call to `backtest-client`
- **Expected Result**: A `backtest_run_id` (timestamp string) is generated and persisted; a GET request is fired to `<BACKTEST_CLIENT_URL>/?symbolName=...&date=...&time_ms=...&deployment_id=...&run_id=...` using `deployment.backtest_date` (or today's date) and `deployment.backtest_speed` (default 1000ms).
- **Notes**: This call is fire-and-forget (`.then/.catch` without awaiting) — verify a failure here does not fail the lifecycle transition response.

#### TC-DEP-033: Transition on foreign deployment blocked (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B calls any lifecycle action on User A's deployment id
- **Expected Result**: Scoped lookup (`_id, user_id`) returns null; controller returns 404/no-op, no state change.

#### TC-DEP-034: Invalid `action` name rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: Hit a nonexistent lifecycle route or malformed action
- **Expected Result**: "Invalid action" error (defensive check in `transitionDeployment`, though routes are fixed so this mainly guards direct service invocation).

### Deployment — Update / Delete

#### TC-DEP-035: Only whitelisted fields updatable (`deployment_name`, `notes`, `backtest_date`, `backtest_speed`, `use_full_amount`)
- **Category**: Functional
- **Priority**: P1
- **Steps**: `PATCH /api/deployments/:id` with allowed + disallowed fields (e.g., `current_status`, `instrument_token`)
- **Expected Result**: Only whitelisted fields change; status/instrument cannot be modified via generic PATCH (must use lifecycle/resolve endpoints).

#### TC-DEP-036: Delete deployment cascades to positions/trades/ledger and re-syncs Redis
- **Category**: Functional
- **Priority**: P0
- **Steps**: `DELETE /api/deployments/:id` on a deployment with trade/position/ledger history
- **Expected Result**: All child records deleted (scoped by `deployment_id` and `user_id`); deployment removed; `syncAllDeploymentsToRedis` and `syncControlledDeploymentsIndex` invoked.

#### TC-DEP-037: Delete does not guard against deleting a RUNNING LIVE deployment
- **Category**: Negative
- **Priority**: P1
- **Steps**: Delete a deployment with `strategy_mode:"LIVE", current_status:"RUNNING"`
- **Expected Result**: Deletion proceeds unconditionally — flag as a safety gap; an actively live-trading deployment can be wiped out along with its trade history mid-flight with no confirmation/guard.

### Deployment — Monitoring & Reporting

#### TC-DEP-038: `/status` returns minimal status projection
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /api/deployments/:id/status`
- **Expected Result**: Returns `{_id, current_status, start_time, end_time, symbol}` only.

#### TC-DEP-039: `/metrics` computes running P&L, wins/losses, win rate from full trade replay
- **Category**: Functional
- **Priority**: P0
- **Steps**: Deployment with a mix of BUY/SELL trades crossing long/short/flat; `GET /api/deployments/:id/metrics`
- **Expected Result**: `total_trades`, `total_pnl`, `wins`, `losses`, `win_rate` computed correctly per the position-flip P&L algorithm (position averaging on same-direction adds, realized P&L on reducing/flipping trades, commission subtracted).

#### TC-DEP-040: `/metrics` O(N) replay performance on large trade history
- **Category**: Performance
- **Priority**: P1
- **Related Issue**: #9
- **Steps**: Seed a deployment with a very large number of trades (e.g., 50k+); call `/metrics` and measure latency
- **Expected Result** (known limitation): Full trade history is replayed from scratch on every call — response time grows linearly with trade count; document actual latency at scale as a performance regression baseline.

#### TC-DEP-041: `/analysis` supports optional date/time range filtering
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /api/deployments/:id/analysis?startDate=2026-01-01&endDate=2026-01-31&startTime=09:15&endTime=15:30`
- **Expected Result**: Only trades within the resolved datetime window are included; `time_range` echoed in response.

#### TC-DEP-042: `/analysis` malformed date strings ignored gracefully
- **Category**: Negative
- **Priority**: P2
- **Steps**: `startDate=notadate`
- **Expected Result**: `parseDateTime` returns null for unparseable input; filter is simply omitted rather than throwing.

#### TC-DEP-043: `/analysis` computes drawdown/drawup and profitability factor correctly
- **Category**: Functional
- **Priority**: P1
- **Steps**: Construct a trade sequence with a known peak-to-trough swing
- **Expected Result**: `max_drawdown`, `max_drawup`, `profitability_factor` (gross_profit/gross_loss, or `"Infinity"` string when `gross_loss` is 0 and profit > 0) match hand-calculated values.

#### TC-DEP-044: `/analysis` and `/metrics` both O(N) — reporting endpoints replay all trades every call
- **Category**: Performance
- **Priority**: P1
- **Related Issue**: #9
- **Steps**: Same as TC-DEP-040 applied to `/analysis`
- **Expected Result**: Same O(N) characteristic; no caching/incremental computation.

#### TC-DEP-045: `/candles` proxies to symbol candle data using deployment's backtest date
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /api/deployments/:id/candles?timeframe=5m`
- **Expected Result**: Returns candle series for `deployment.symbol` on `deployment.backtest_date` (or today) at requested timeframe.

#### TC-DEP-046: `/logs` endpoint always returns an empty array — no code path ever populates `deployment.logs`
- **Category**: Regression / Bug
- **Priority**: P1
- **Steps**: (1) Run a deployment through a full lifecycle (`start` → trades → `stop`/`complete`); (2) `GET /api/deployments/:id/logs`; (3) grep the codebase for any write to `deployment.logs` or `$push`/`$set` on a `logs` field on the Deployment model
- **Expected Result** (current bug): Route handler (`deployment.js` ~L833) returns `deployment.logs || []`, but no service, controller, strategy, or Kafka consumer ever appends to this array — response is always `[]` regardless of deployment activity. UI consumers expecting operational/strategy logs will show a permanently blank log panel. Document as a missing feature (logs never wired) rather than a filtering bug; verify whether any UI surface calls this endpoint and handles the empty state gracefully.

### Sweep Signal Logs (liquidity_sweep instrumentation)

#### TC-DEP-047: `POST /:id/sweep-signals` accepts either user auth or service token
- **Category**: Functional
- **Priority**: P1
- **Steps**: Call once with valid user JWT, once with `X-Service-Token`, once with neither
- **Expected Result**: First two succeed; third rejected (401).

#### TC-DEP-048: `GET /:id/sweep-signals/stats` and `GET /:id/sweep-signals` require standard user auth (no service token)
- **Category**: Security
- **Priority**: P2
- **Steps**: Call both with only a service token, no user JWT
- **Expected Result**: Rejected — these two routes use `authenticate` only, not `authenticateOrServiceToken`.

### Redis Sync Integrity

#### TC-DEP-049: `syncAllDeploymentsToRedis` publishes only RUNNING deployments, keyed by mode
- **Category**: Functional
- **Priority**: P0
- **Steps**: Have RUNNING deployments in LIVE, PAPER, and BACKTEST modes across several symbols; trigger any action that calls sync (e.g., start/stop)
- **Expected Result**: `strategies:live:<symbol>` receives entries for LIVE and PAPER deployments (both non-backtest, `isTest` flag differentiates); `strategies:backtest:<symbol>` receives BACKTEST entries; stale keys not present in the new set are deleted.

#### TC-DEP-050: Redis entry embeds broker's `is_internal` and account commission fields
- **Category**: Functional
- **Priority**: P1
- **Steps**: Inspect a synced Redis entry's `is_internal_broker`, `commission_type`, `commission_rate` fields
- **Expected Result**: Correctly mirrors the account's linked broker/commission configuration at sync time (note: this is a point-in-time snapshot — stale until next sync if account settings change while RUNNING).

#### TC-DEP-051: Stopping the only RUNNING deployment for a symbol removes its Redis key entirely
- **Category**: Functional
- **Priority**: P2
- **Steps**: Stop the last RUNNING deployment for a given symbol; inspect Redis
- **Expected Result**: `strategies:live:<symbol>` or `strategies:backtest:<symbol>` key is deleted (empty active-strategies set treated as stale).
