# Kafka: `deployment-symbol-resolver-consumer` — Test Case Plan

## Scope
Consumes live/backtest ticks for underlying instruments, maintains an in-memory `interestMap` (underlying token → list of controlled deployments interested in strike-grid changes, refreshed from Redis every `SYMBOL_CONTROL_INDEX_REFRESH_MS`, default 10s), computes a reference strike from LTP, and calls BackTestApp's `POST /deployments/:id/resolve-symbol` (service-token authenticated) when the strike grid shifts, subject to a per-deployment throttle (`SYMBOL_CONTROL_RESOLVE_THROTTLE_MS`, default 5s). Single replica.

## Prerequisites
- Redis populated with `symbol_control:underlyings` SET and `symbol_control:deps:<token>` JSON entries (maintained by BackTestApp's `syncControlledDeploymentsIndex`)
- BackTestApp reachable at `BACKTEST_APP_URL` with `BACKTEST_SERVICE_TOKEN` configured identically on both sides
- At least one deployment with `symbol_control.enabled:true` and a valid `strike_price_diff`

## Test Cases

### Interest Map & Fast-Path Filtering

#### TC-DSR-001: Ticks for underlyings with no controlled deployments are ignored via fast-path check
- **Category**: Functional / Performance
- **Priority**: P1
- **Steps**: Publish a tick for a symbol not present in `interestMap`
- **Expected Result**: `if (!interestMap.has(symbol)) return;` short-circuits before even parsing the JSON body — minimizes CPU overhead for the vast majority of uninteresting ticks in a high-throughput feed.

#### TC-DSR-002: Interest map is populated from Redis on startup before the Kafka consumer subscribes
- **Category**: Functional
- **Priority**: P1
- **Steps**: Trace `createConsumer()` — `refreshInterestMap()` runs once, then `setInterval` is scheduled, THEN the Kafka consumer connects/subscribes
- **Expected Result**: No tick can be missed-processed against a stale empty map at cold start (map is populated before consumption begins).

#### TC-DSR-003: Interest map refreshes every `SYMBOL_CONTROL_INDEX_REFRESH_MS`
- **Category**: Functional
- **Priority**: P1
- **Steps**: Add a new controlled deployment (new underlying) to Redis mid-run; wait up to 10s (default interval)
- **Expected Result**: The new underlying eventually appears in `interestMap` without requiring a service restart.

### Refresh Race Condition (Core Regression)

#### TC-DSR-004: Wholesale interest-map replacement discards recent in-memory-only mutations
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #67
- **Steps**: Trigger a resolve for deployment X that succeeds and updates the LOCAL `dep.last_resolved_strike`/`dep.pending_resolve` in `handleTick` (in-memory mutation on the object inside `interestMap`); before the next scheduled `refreshInterestMap()` interval fires AND before BackTestApp's own Redis write-back (`syncControlledDeploymentsIndex`) has necessarily landed, force `refreshInterestMap()` to run (or simply wait for the natural 10s interval to elapse faster than expected)
- **Expected Result** (current bug): `refreshInterestMap()` performs a full wholesale replacement (`interestMap = next`) built entirely from fresh Redis reads — any in-memory-only mutation to `dep.last_resolved_strike`/`dep.pending_resolve` that has NOT yet been persisted back to Redis (by BackTestApp, asynchronously, in response to the resolve call) is silently discarded. If the strike grid changes again within this race window, a duplicate `resolve-symbol` call may fire for a strike that was technically already resolved from this consumer's perspective moments earlier.
- **Notes**: The resolve API call itself (`callResolveApi`) is throttled per-deployment (`RESOLVE_THROTTLE_MS`), which mitigates but does NOT eliminate the race — the throttle map (`lastResolveAt`) is separate from and unaffected by the interest-map refresh, so a resolve call could still be issued twice in edge-timing scenarios spanning a refresh boundary.

#### TC-DSR-005: `pending_resolve` set by BackTestApp response is preserved locally until overwritten by refresh
- **Category**: Functional
- **Priority**: P1
- **Steps**: Trigger a resolve while a position is open (BackTestApp responds `deferred:true`); observe `dep.pending_resolve` set to `true` locally, preventing further resolve attempts for that deployment until flat
- **Expected Result**: Correctly blocks repeated resolve attempts within the current in-memory map's lifetime — verify this local flag correctly gets refreshed from Redis truth on the next `refreshInterestMap()` cycle once BackTestApp's own state (updated via `flushPendingSymbolResolve`) propagates through `symbol_control:deps:<token>`.

### Strike Grid Computation & Throttling

#### TC-DSR-006: Reference strike recomputed correctly from LTP and strike_price_diff
- **Category**: Functional
- **Priority**: P0
- **Steps**: `strike_price_diff:50`, LTP ticks at 24875, 24900, 24925
- **Expected Result**: `computeReferenceStrike` rounds to nearest 50: 24875→24900 (rounds to nearest multiple), 24900→24900, 24925→24900 or 24950 depending on rounding direction — verify exact `Math.round(price/diff)*diff` behavior at each boundary.

#### TC-DSR-007: No resolve call fires when the computed strike matches `last_resolved_strike`
- **Category**: Functional
- **Priority**: P1
- **Steps**: Publish a tick whose reference strike equals the currently cached `last_resolved_strike`
- **Expected Result**: Early return — no HTTP call to BackTestApp, no throttle timestamp update.

#### TC-DSR-008: Resolve calls are throttled per-deployment to at most once per `RESOLVE_THROTTLE_MS`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Publish rapid ticks causing the strike grid to cross multiple boundaries within less than 5s (default throttle)
- **Expected Result**: Only one `resolve-symbol` call fires per deployment within the throttle window, even if the strike moved through several grid lines; the LAST computed strike within the window is effectively "missed" until the next tick after the throttle window re-triggers a call (verify whether this can leave the deployment resolved to a stale/intermediate strike if ticks stop arriving exactly at the throttle boundary).

#### TC-DSR-009: Zero or missing `strike_price_diff` disables resolve attempts for that deployment
- **Category**: Negative
- **Priority**: P2
- **Steps**: A deployment entry has `strike_price_diff:0` or undefined
- **Expected Result**: `!(strikeDiff > 0)` guard skips processing entirely for that dependency.

#### TC-DSR-010: `pending_resolve:true` deployments are skipped even if the strike grid changes further
- **Category**: Functional
- **Priority**: P1
- **Steps**: A deployment is `pending_resolve:true` (waiting for position to flatten); publish further ticks moving the strike grid multiple lines
- **Expected Result**: No resolve calls fire while `pending_resolve` remains true, regardless of how far the strike has drifted — resolution only resumes after BackTestApp flushes the pending state and the next `refreshInterestMap()` reflects `pending_resolve:false`.

### HTTP Integration with BackTestApp

#### TC-DSR-011: Successful resolve updates local `last_resolved_strike`/`pending_resolve` from the API response
- **Category**: Functional
- **Priority**: P1
- **Steps**: Trigger a successful (non-deferred) resolve; inspect the local `dep` object post-call
- **Expected Result**: `dep.last_resolved_strike` and `dep.pending_resolve` are updated from `result.data.deployment.symbol_control` fields in the response, keeping the in-memory cache consistent with BackTestApp's authoritative state until the next full refresh.

#### TC-DSR-012: HTTP error response (non-2xx) from resolve-symbol is caught and logged per-deployment, doesn't abort the batch
- **Category**: Negative
- **Priority**: P1
- **Steps**: Force BackTestApp to return a 409 (conflict) or 500 for one deployment's resolve call while another deployment's tick is processed in the same `Promise.all`
- **Expected Result**: `callResolveApi` throws; caught within that specific deployment's `.map()` callback (`try/catch` inside), logged (`Failed resolve for deployment ...`); other deployments in the same tick's `Promise.all` are unaffected.

#### TC-DSR-013: Missing/incorrect `BACKTEST_SERVICE_TOKEN` results in 403 from BackTestApp
- **Category**: Security
- **Priority**: P1
- **Steps**: Misconfigure `BACKTEST_SERVICE_TOKEN` on this consumer to not match BackTestApp's value; trigger a resolve
- **Expected Result**: BackTestApp's `requireServiceToken` middleware rejects with 403; consumer logs the failure and continues (does not crash).

#### TC-DSR-014: Non-JSON error response body from BackTestApp handled gracefully
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate BackTestApp returning a non-JSON error body (e.g., HTML error page from a proxy)
- **Expected Result**: `callResolveApi`'s `try { JSON.parse } catch { body = {raw:text} }` fallback prevents a parse-error crash; the raw text is included in the thrown error message.

### Startup & Resilience

#### TC-DSR-015: Malformed JSON tick or missing key handled without crashing the whole consumer
- **Category**: Negative
- **Priority**: P1
- **Steps**: Publish malformed JSON / null-key messages
- **Expected Result**: Caught by `eachMessage`'s try/catch → `handleFatalError` (verify whether this is process-fatal or per-message recoverable, consistent with sibling consumers).

#### TC-DSR-016: Periodic refresh failure (Redis outage) is logged and does not stop the interval loop
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate Redis unavailable during a scheduled `refreshInterestMap()` tick
- **Expected Result**: Error caught and logged (`Periodic index refresh failed`); `setInterval` continues scheduling future attempts; `interestMap` remains at its last successfully-fetched state (stale but not wiped) during the outage.
