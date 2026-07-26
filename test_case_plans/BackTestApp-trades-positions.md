# BackTestApp — Trades & Positions — Test Case Plan

## Scope
Covers `Trade` creation (`/api/trade` legacy + `/api/trades`), automatic `Position` lifecycle management (open/scale-in/partial-close/full-close/flip), ledger side-effects, deployment cached position-state (`position_size`/`average_entry_price`), Redis live-position sync, and reporting endpoints that replay trade history. `createTrade` is the single most complex, transactional write path in BackTestApp (uses a Mongo session/transaction).

## Prerequisites
- Authenticated user with an Account (sufficient balance), a Strategy, a UserSymbol, and ideally a Deployment (for O(1) cached position path)
- `BACKTEST_SERVICE_TOKEN` for the legacy service-token trade endpoint
- Sample exported tick JSON files under `exportedData/<date>/<symbol>.json` for backtest excursion tests
- Ability to run concurrent requests for transaction-isolation checks

## Test Cases

### Trade Creation — Core Validation

#### TC-TRD-001: Create BUY trade opens a new LONG position when flat
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/trades` with `{deployment_id, price, quantity, type_of_order:"BUY", execution_time}` on a deployment with `position_size:0`
- **Expected Result**: Trade created (`status:"EXECUTED"` default); a new `Position` doc created with `status:"OPEN"`, `direction:"LONG"`, `open_size=quantity`, `average_entry_price=price`; deployment's cached `position_size`/`average_entry_price` updated; Ledger DEBIT entry created; account balance debited by `price*quantity + commission`.

#### TC-TRD-002: Create SELL trade opens a new SHORT position when flat
- **Category**: Functional
- **Priority**: P0
- **Steps**: Same as above with `type_of_order:"SELL"` on a flat deployment
- **Expected Result**: New Position with `direction:"SHORT"`; account credited `price*quantity - commission`.

#### TC-TRD-003: Missing `user_id` rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Call service/controller path without `user_id` in payload
- **Expected Result**: "user_id is required" error, transaction aborted.

#### TC-TRD-004: Missing `account_id` (and no resolvable deployment) rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/trades` with no `deployment_id` and no `account_id`
- **Expected Result**: "account_id is required" error.

#### TC-TRD-005: Incomplete type/range validation at the HTTP boundary — zero/negative quantity accepted
- **Category**: Negative / Regression
- **Priority**: P0
- **Related Issue**: #3
- **Steps**: `POST /api/trades` with `quantity: 0`, then `quantity: -10`
- **Expected Result** (current gap in the shared validation used by placeOrders — verify whether BackTestApp's own `createTradeController` independently validates numeric ranges): confirm whether zero/negative quantity produces a nonsensical Position (`open_size:0` or negative) rather than a clean 400 rejection.

#### TC-TRD-006: Non-numeric `price`/`quantity` string values
- **Category**: Negative
- **Priority**: P1
- **Related Issue**: #3
- **Steps**: `POST /api/trades` with `price: "abc"`
- **Expected Result**: Should be rejected with a clear validation error; verify actual behavior (Mongoose `Number` cast error vs silent `NaN` propagation into balance/position math).

#### TC-TRD-007: Invalid `type_of_order` enum rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `type_of_order: "SHORT"` (not BUY/SELL)
- **Expected Result**: Schema enum validation error.

#### TC-TRD-008: Trade referencing a deployment owned by a different user rejected
- **Category**: Security
- **Priority**: P0
- **Steps**: `deployment_id` belongs to User B; caller is User A
- **Expected Result**: "Associated deployment does not belong to the authenticated user" error.

#### TC-TRD-009: Trade referencing a nonexistent deployment_id rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Random/garbage `deployment_id`
- **Expected Result**: "Associated deployment not found" error.

#### TC-TRD-010: Trade referencing an inactive UserSymbol rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `user_symbol_id` (or resolved via deployment/symbol lookup) points to `is_active:false`
- **Expected Result**: "Cannot place order: Symbol ... is inactive" error.

#### TC-TRD-011: Trade with an account belonging to a different user rejected
- **Category**: Security
- **Priority**: P0
- **Steps**: `account_id` resolves to an account owned by another user
- **Expected Result**: "Account does not belong to the authenticated user" error.

#### TC-TRD-012: Trade referencing nonexistent account rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Garbage `account_id`
- **Expected Result**: "Account associated with ID ... does not exist" error.

#### TC-TRD-013: BUY order rejected when balance insufficient (including commission)
- **Category**: Negative
- **Priority**: P0
- **Steps**: Account balance < `price*quantity + commission`; submit BUY
- **Expected Result**: "Insufficient balance for BUY order (including commission)" error; entire transaction aborted (no Trade/Position/Ledger created, no balance change).

#### TC-TRD-014: SELL (short-open) is NOT balance-checked
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: Account balance is very low or zero; submit a SELL that opens a fresh short position
- **Expected Result**: No balance sufficiency check exists for SELL/short-open in the code path — verify this is intentional (margin not modeled) or flag as a gap allowing unbounded short exposure regardless of account balance.

#### TC-TRD-015: Trade without `deployment_id` auto-attaches to the account's "Manual" deployment if one exists
- **Category**: Functional
- **Priority**: P2
- **Steps**: Submit a trade with only `account_id` (no `deployment_id`) where a "Manual" deployment exists for that account
- **Expected Result**: `deployment_id` is silently populated from the Manual deployment; strategy/symbol fields inherited from it.

#### TC-TRD-016: Trade with symbol string (no deployment/user_symbol_id) resolves via UserSymbol lookup
- **Category**: Functional
- **Priority**: P2
- **Steps**: Submit `{account_id, symbol:"RELIANCE", price, quantity, type_of_order}` with no `deployment_id`/`user_symbol_id`
- **Expected Result**: Resolves `user_symbol_id`/`instrument_token` from the user's own watchlisted `UserSymbol` (case-insensitive `symbol` match); errors with "Symbol ... not found in user's watchlisted symbols" if none exists.

### Position Lifecycle Transitions

#### TC-TRD-017: Scale-in — additional BUY on an existing LONG increases size and recalculates weighted average entry price
- **Category**: Functional
- **Priority**: P0
- **Steps**: Existing LONG position open_size=10 @ avg 100; BUY 5 more @ 110
- **Expected Result**: `open_size=15`; `average_entry_price` = weighted average per the position-averaging formula including commission; `total_size` incremented; Position stays OPEN.

#### TC-TRD-018: Partial close — SELL less than open LONG size realizes partial P&L
- **Category**: Functional
- **Priority**: P0
- **Steps**: LONG open_size=10 @ avg 100; SELL 4 @ 120
- **Expected Result**: `realised_pnl` increases by `(120-100)*4 - commission`; `open_size` reduces to 6; Position remains OPEN; trade's own `pnl` field reflects the same realized amount.

#### TC-TRD-019: Full close — SELL exactly matching open LONG size closes the position
- **Category**: Functional
- **Priority**: P0
- **Steps**: LONG open_size=10 @ avg 100; SELL 10 @ 130
- **Expected Result**: Position `status→CLOSED`, `open_size=0`, `unrealised_pnl=0`, `closed_at` set; `realised_pnl` reflects full exit P&L; Redis "remove" op issued to clear the live open-position cache.

#### TC-TRD-020: Flip — SELL exceeding open LONG size closes the long and opens a fresh SHORT in one trade
- **Category**: Functional
- **Priority**: P0
- **Steps**: LONG open_size=10 @ avg 100; SELL 15 @ 90 in a single trade
- **Expected Result**: `crossesZero` path triggers: existing LONG position is closed (realized P&L on 10 units), a brand-new SHORT `Position` doc is created for the remaining 5 units at the flip price; the single `Trade` document's `position_id` links to whichever leg is set as `linkedPositionId` (verify which — code sets it to the closed position unless overridden); both Redis "remove" and "sync" ops are issued.

#### TC-TRD-021: Position with no prior Position doc (legacy/pre-Position trades) synthesizes a fresh Position on scale-in/partial/full-close paths
- **Category**: Regression
- **Priority**: P2
- **Steps**: Deployment has nonzero cached `position_size` (e.g., migrated data) but no matching `Position` document; submit a trade that would be a scale-in/partial-close
- **Expected Result**: Since `openPositionDoc` lookup fails, the fallback branch creates a synthetic new Position only if the resulting size is nonzero; verify no crash and reasonably consistent state.

#### TC-TRD-022: Deployment cached `position_size`/`average_entry_price` stays in sync with Position state (O(1) fast path)
- **Category**: Functional
- **Priority**: P1
- **Related Issue**: #9
- **Steps**: Execute a sequence of trades on a deployment; after each, compare `deployment.position_size`/`average_entry_price` against independently recomputed values from full trade replay
- **Expected Result**: They match — confirms the O(1) caching optimization correctly mirrors what a full replay would produce (positive regression test for the fix described in issue #9).

#### TC-TRD-023: Trades without `deployment_id` fall back to full O(N) trade-history replay every time
- **Category**: Performance / Regression
- **Priority**: P1
- **Related Issue**: #9
- **Steps**: Create many trades (e.g., 10k) against the same `account_id`+`symbol` with no `deployment_id`; submit one more trade and measure latency
- **Expected Result** (known limitation): `createTrade` replays the entire non-deployment trade history from scratch (`Trade.find({account_id, symbol}).sort(...)`) to determine current position/avg-price — latency grows linearly with trade count.

### Backtest Excursion Tracking

#### TC-TRD-024: BACKTEST-mode position tracks max_up/max_down from exported tick files between trades
- **Category**: Functional
- **Priority**: P1
- **Steps**: Deployment `strategy_mode:"BACKTEST"`; ensure `exportedData/<date>/<symbol>.json` exists with tick data spanning the position's open interval; close the position with a second trade
- **Expected Result**: `updateBacktestExcursions` reads tick files across the date range between the last trade and the closing trade, computes unrealized P&L/pct at each tick, and updates `max_up`/`max_down`/`max_up_pct`/`max_down_pct` on the position accordingly.

#### TC-TRD-025: Backtest excursion tick file lookup falls back across three candidate paths
- **Category**: Functional
- **Priority**: P2
- **Steps**: Remove the tick file from the primary path (`../exportedData/<date>/<symbol>.json` relative to service) but leave it present under `/shared/exportedData/<date>/<symbol>.json`
- **Expected Result**: Fallback path resolution succeeds; excursions still computed. Verify third fallback (absolute dev path) is a dev-only convenience and doesn't leak into production silently masking missing data.

#### TC-TRD-026: Missing tick files for the date range logged and skipped without crashing
- **Category**: Negative
- **Priority**: P2
- **Steps**: No tick files exist for the relevant date(s)
- **Expected Result**: Warning logged (`Ticks file not found`); excursion fields remain at prior values; trade/position save still succeeds.

#### TC-TRD-027: Multi-day BACKTEST position spans correctly aggregate ticks across each date in range
- **Category**: Functional
- **Priority**: P2
- **Steps**: Open a position on day 1, close on day 3, with tick files present for days 1–3
- **Expected Result**: All three days' tick files are read and merged; excursions reflect the full multi-day range.

### Reporting / Query

#### TC-TRD-028: List trades scoped to caller; filter by `type_of_order`, `status`, `symbol`, `account_id`, `deployment_id` (single or array values)
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /api/trades?type_of_order=BUY&type_of_order=SELL` (array), `?symbol=RELIANCE`, `?account_id=<id>`
- **Expected Result**: Filters combine correctly with `$in`; unmatched `account_id` (foreign/nonexistent) returns an empty result set rather than an error, consistent with the ledger service pattern.

#### TC-TRD-029: `GET /api/trades/:id` resolves by Mongo `_id` or `trade_id`, scoped to caller
- **Category**: Security
- **Priority**: P1
- **Steps**: Fetch by both ID forms; attempt fetching another user's trade
- **Expected Result**: Own trade resolves via either identifier; foreign trade returns null/404.

#### TC-TRD-030: `DELETE /api/trades/:id` does not cascade-adjust Position/Ledger/account balance
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: Delete an executed trade that contributed to a Position's realized P&L and the account's current balance
- **Expected Result**: Trade document removed, but the linked Position's `realised_pnl`/`open_size` and the Account's `current_balance` are NOT recalculated/reverted — verify this produces a permanently inconsistent state (orphaned Ledger entry referencing a deleted `trade_id`, Position stats no longer matching remaining trades).

### Legacy / Service-Token Endpoint

#### TC-TRD-031: `POST /api/trade` (legacy) accepts `X-Service-Token` in lieu of user JWT
- **Category**: Functional
- **Priority**: P1
- **Steps**: Call `POST /api/trade` with a valid `X-Service-Token` header and a full trade payload including `user_id` in the body
- **Expected Result**: Request succeeds without a user JWT.

#### TC-TRD-032: Legacy endpoint trusts body `user_id` with no further verification when service token is used
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #49
- **Steps**: Using a valid `X-Service-Token`, submit a trade with `user_id` set to an arbitrary existing user's ID (not the token holder's "identity", since service tokens have no identity)
- **Expected Result** (current bug): Trade is created attributed to the arbitrary `user_id` with no cross-check — confirms that leakage of `BACKTEST_SERVICE_TOKEN` allows creating trades as any user.

#### TC-TRD-033: Legacy endpoint without service token AND without user JWT rejected
- **Category**: Security
- **Priority**: P1
- **Steps**: `POST /api/trade` with neither auth mechanism
- **Expected Result**: 401 rejected by `authenticateOrServiceToken`.

### Position Endpoints

#### TC-POS-001: List positions scoped to caller
- **Category**: Security
- **Priority**: P1
- **Steps**: `GET /api/positions` as two different users
- **Expected Result**: Each sees only their own positions.

#### TC-POS-002: Get position by ID scoped to caller (IDOR check)
- **Category**: Security
- **Priority**: P1
- **Steps**: `GET /api/positions/:id` for a position owned by another user
- **Expected Result**: 404/not found.

#### TC-POS-003: OPEN position's `unrealised_pnl`/`max_up`/`max_down` reflect the latest LTP tick (live mode)
- **Category**: Functional
- **Priority**: P1
- **Steps**: For a LIVE/PAPER (non-BACKTEST) open position, submit a partial trade at a new price
- **Expected Result**: `last_ltp`, `unrealised_pnl`, and excursion fields update using `calcUnrealizedPnl`/`calcProfitPct`/`applyExcursion` helpers based on the new price.

#### TC-POS-004: Redis live-position cache synced on open/scale/flip, removed on full close
- **Category**: Functional
- **Priority**: P1
- **Steps**: Open a position (verify Redis sync), scale it (verify re-sync), fully close it (verify removal)
- **Expected Result**: `syncOpenPositionToRedis`/`removeOpenPositionFromRedis` are called with the correct position payload at each stage, only after the Mongo transaction commits (never on a rolled-back transaction).

#### TC-POS-005: Redis sync failure after commit does not roll back or fail the trade response
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate Redis unavailability during the post-commit Redis sync step
- **Expected Result**: Error caught and logged (`[createTrade] Redis sync failed after commit`); HTTP response still reflects successful trade/position/ledger creation (Mongo state is source of truth).

### Transactional Integrity

#### TC-TRD-034: Mongo transaction aborts cleanly on any validation failure mid-flow — no partial writes
- **Category**: Regression
- **Priority**: P0
- **Steps**: Trigger a failure deliberately at a late stage of `createTrade` (e.g., valid until the balance check, which then fails)
- **Expected Result**: No Trade, Position, or Ledger documents persist; account balance unchanged — the whole operation is wrapped in `session.startTransaction()`/`abortTransaction()`.

#### TC-TRD-035: Concurrent trades on the same deployment are serialized correctly (no lost position updates)
- **Category**: Regression / Performance
- **Priority**: P0
- **Steps**: Fire multiple concurrent `POST /api/trades` requests against the same deployment (alternating BUY/SELL)
- **Expected Result**: Because each trade uses a Mongo session/transaction, verify whether write conflicts are retried or surfaced as errors; final `deployment.position_size` should be consistent with a serialized replay of all trades (contrast with the ledger deposit/withdraw race in issue #35, which has no transaction at all — this path is comparatively safer, but verify write-conflict handling explicitly under load).

#### TC-TRD-036: Flush of deferred symbol_control resolve triggers exactly once after a full flat close
- **Category**: Functional
- **Priority**: P2
- **Steps**: A symbol_control-enabled deployment has `pending_resolve:true` due to an earlier deferred resolve while a position was open; submit the trade that fully closes the position
- **Expected Result**: `flushPendingSymbolResolve` is invoked post-commit and triggers the deferred remap, since the deployment is now flat.
