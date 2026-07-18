# MicroService: placeorder — Test Case Plan

## Scope
Covers `MicroServices/Orders/placeOrders` (`server.js` + `dependency.js`), the central order-execution gateway exposed publicly via nginx at `/placeorder`. Decides LIVE-vs-PAPER/internal-broker routing based on client-supplied `strategy_details`, calls the Upstox broker for live external orders, records every order in BackTestApp via `POST /api/trade`, syncs account balance to Redis, and audit-logs the order to Kafka.

## Prerequisites
- `placeorder` service running with `NGINX_ADDRESS`, `BACKTEST_APP_URL`, `BACKTEST_TRADE_URL`, `BACKTEST_SERVICE_TOKEN`, `FUNDS_AND_MARGIN_API_URL`, `TARGET_TOPIC` configured
- A valid Upstox access token cached in Redis for at least one test `user_id` (for LIVE-path tests) — or a mocked Upstox endpoint
- BackTestApp reachable with a valid account/deployment to record trades against
- Kafka reachable for `storeOrderDetails` audit logging

## Test Cases

### Input Validation

#### TC-PO-001: A well-formed request with all required fields succeeds end-to-end
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /` with `instrument_token`, `price`, `quantity`, `transaction_type`, `strategy_details.user_id` all present and valid; PAPER mode
- **Expected Result**: 200 response; trade recorded in BackTestApp; account balance synced to Redis; order details published to Kafka.

#### TC-PO-002: Missing `instrument_token` returns 400
- **Category**: Negative
- **Priority**: P0
- **Steps**: Omit `instrument_token` from the request body
- **Expected Result**: `400 Bad Request: Missing required order fields...`.

#### TC-PO-003: Missing `strategy_details.user_id` (or missing `strategy_details` entirely) returns 400
- **Category**: Negative
- **Priority**: P0
- **Steps**: Omit `strategy_details`, and separately send `strategy_details:{}` with no `user_id`
- **Expected Result**: 400 in both cases — confirms the nested-field presence check works correctly.

#### TC-PO-004: Zero or negative `quantity` is NOT rejected (validation gap)
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #3
- **Steps**: `POST /` with `quantity:0`, and separately `quantity:-5`, all other fields valid
- **Expected Result** (current bug): The presence check `body.quantity === undefined` passes for both `0` and `-5` (neither is `undefined`) — request proceeds to the broker/BackTestApp with an invalid quantity, producing either a broker rejection (wasted live API call) or a corrupted/invalid trade record with negative size.

#### TC-PO-005: Non-numeric `quantity`/`price` strings are NOT rejected (type-checking gap)
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #3
- **Steps**: `POST /` with `quantity:"abc"` or `price:"not-a-number"`
- **Expected Result** (current bug): No `typeof`/`isNaN` check exists — the malformed value flows through to `filteredBody`/`testAPIBody` and ultimately to the broker call or BackTestApp's trade creation, likely producing a downstream 500 or, worse, a silently coerced/garbage numeric value (e.g., `Number("abc")` → `NaN` propagating into calculations).

#### TC-PO-006: `transaction_type` and `order_type` are not restricted to a valid enum
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #3
- **Steps**: `POST /` with `transaction_type:"FOOBAR"` (not `BUY`/`SELL`)
- **Expected Result** (current bug): No enum validation — request proceeds; the invalid value is forwarded to Upstox (which will likely reject it, wasting a live API round-trip) or to BackTestApp's `type_of_order` field, which DOES have its own model-level enum validation (see `BackTestApp-trades-positions.md`) and would reject it there — confirms validation is inconsistently pushed downstream rather than caught at the gateway.

### LIVE vs PAPER / Broker Routing (Trust Boundary)

#### TC-PO-007: `strategy_mode:"LIVE"` with no internal-broker flag routes to Upstox FIRST, then records in BackTestApp only on broker success
- **Category**: Functional
- **Priority**: P0
- **Steps**: `strategy_details:{strategy_mode:"LIVE", user_id, account_id}`, valid Upstox token cached
- **Expected Result**: `placeOrders()` (Upstox call) executes before `triggerBackTestApp()`; if Upstox succeeds, the trade is recorded; if Upstox throws, `triggerBackTestApp` is never reached and the whole request 500s (see TC-PO-011).

#### TC-PO-008: PAPER mode (`isTest` not false / `strategy_mode !== "LIVE"`) never calls Upstox
- **Category**: Functional
- **Priority**: P0
- **Steps**: `strategy_details:{strategy_mode:"PAPER"}` (or omitted)
- **Expected Result**: `placeOrders()` is never invoked; `triggerBackTestApp()` runs directly; response result is `'Test Mode: Order not placed with external broker.'` or the BackTestApp order response.

#### TC-PO-009: `is_internal_broker:true` skips Upstox even when `strategy_mode:"LIVE"`
- **Category**: Functional
- **Priority**: P0
- **Steps**: `strategy_details:{strategy_mode:"LIVE", is_internal_broker:true}`
- **Expected Result**: `isLive && !isInternalBroker` evaluates false — routes to the internal-broker branch; result is `'Internal Broker Mode: Order recorded internally.'`; NO real broker call made despite `strategy_mode:"LIVE"`.

#### TC-PO-010: An unauthenticated, arbitrary caller can force `isTest:false` to trigger a REAL broker trade for any known `user_id`/`account_id`
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #18, #14
- **Steps**: As an anonymous caller (no auth — this endpoint has none per issue #14), `POST /placeorder` through the public nginx route with `strategy_details:{user_id:"<any known/guessed user>", account_id:"<any known account>", strategy_mode:"LIVE"}` and a real `instrument_token`
- **Expected Result** (current bug): The server derives `isLive` PURELY from the client-supplied `strategy_mode`/`isTest` fields (`server.js:L33`) with NO server-side lookup of the actual deployment/strategy's configured mode from MongoDB. If the target user has a valid cached Upstox token (per TC-UPX tests), this places a REAL trade on their broker account, fully attacker-controlled (symbol, quantity, direction) — full unauthenticated live-trading takeover. Similarly, `is_internal_broker:true` can be used to bypass the broker and fabricate internal ledger trades for any account.
- **Notes**: This is one of the most severe issues in the entire system — the fix requires deriving `isLive`/broker routing from a server-side deployment lookup by `deployment_id`, never trusting client-supplied mode flags, AND requires adding authentication to this endpoint at all (currently entirely open).

### Live Fill-Price Accuracy

#### TC-PO-011: LIVE MARKET order zeroes `filteredBody.price` before the Upstox call, but the UNMODIFIED original `body.price` (still 0 or client-supplied) is sent to BackTestApp — broker's actual fill price is never captured
- **Category**: Regression / Bug
- **Priority**: P0
- **Related Issue**: #19
- **Steps**: `strategy_mode:"LIVE"`, `order_type:"MARKET"`, `price:0` (typical for a market order); Upstox fills at, say, ₹152.35; inspect the resulting BackTestApp trade record
- **Expected Result** (current bug): `filteredBody.price` is zeroed for the Upstox call (correct — market orders shouldn't specify a limit price), but `triggerBackTestApp(body)` is called with the ORIGINAL `body` object (line 43), which still has whatever `price` the client originally sent (commonly `0`). `dependency.js`'s LTP-fallback logic (`!isLive && price is falsy → fetch LTP`) explicitly only runs when `!isLive` — for a LIVE order this branch is skipped entirely, so BackTestApp's trade is recorded with `price:0` (or the client's arbitrary submitted price) rather than Upstox's actual fill price of ₹152.35. This corrupts P&L, average-entry-price, and account balance calculations for every live market order.
- **Notes**: The Upstox API response from `placeOrders()` (`result`) likely contains fill/average-price data that is never extracted or forwarded — verify what fields `result` actually contains and confirm none of them reach `triggerBackTestApp`.

#### TC-PO-012: LIVE LIMIT order price IS correctly forwarded (price is non-zero and known upfront)
- **Category**: Functional (positive control)
- **Priority**: P1
- **Steps**: `strategy_mode:"LIVE"`, `order_type:"LIMIT"`, `price:150.50`
- **Expected Result**: Since the client-specified limit price is meaningful and non-zero, the (still-buggy) pass-through of `body.price` to BackTestApp happens to be "correct" in this case (the limit price IS the intended reference price) — but note this is coincidental, not a designed safeguard; if the broker fills at a materially different price due to slippage, the ledger still won't reflect it (LIMIT orders can experience partial fills / price improvement not captured here either).

#### TC-PO-013: PAPER mode with `price:0`/missing correctly fetches LTP as a simulated fill price
- **Category**: Functional (positive control)
- **Priority**: P1
- **Steps**: PAPER mode order with no `price` specified
- **Expected Result**: `dependency.js`'s `!isLive && (price===0||undefined||null)` branch correctly fires, calling `fetchLTP` and using the live LTP as the simulated fill — this path IS correctly implemented; the bug (#19) is isolated specifically to the LIVE branch.

### Balance Sync

#### TC-PO-014: Successful LIVE order syncs balance from the broker's own live funds/margin endpoint (double-sync)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete a successful LIVE order end-to-end
- **Expected Result**: Balance is set to Redis TWICE — once from BackTestApp's `closing_balance` (internal ledger view) and again immediately after from `getLiveAccountBalance` (`FUNDS_AND_MARGIN_API_URL`, the actual broker's `availableMargin`) — the SECOND write wins and reflects the true broker balance; verify both calls complete and the final cached value matches the broker's real margin, not the internal ledger's calculation (which may differ due to margin/leverage vs. simple cash accounting).

#### TC-PO-015: `getLiveAccountBalance` failure aborts the entire request with a 500, even though the order itself (broker + BackTestApp record) already succeeded
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: Simulate `FUNDS_AND_MARGIN_API_URL` being unreachable during a successful LIVE order
- **Expected Result**: `getLiveAccountBalance` throws (it does NOT catch internally — throws propagate to the outer route handler's catch, per `dependency.js:L161-180`); the route returns `500` to the caller even though the actual trade was successfully placed with the broker AND recorded in BackTestApp — a misleading failure response for what was actually a successful order, risking client-side retry logic double-submitting the same order.

#### TC-PO-016: Invalid/missing `closing_balance` from BackTestApp response logs a warning (PAPER path) but does not fail the request
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate BackTestApp returning a response without a `data.closing_balance` field
- **Expected Result**: PAPER-mode branch logs `⚠️ Warning: Received invalid closing balance...` and continues; response still sent successfully.

### Upstox Broker Call Failure Handling

#### TC-PO-017: Upstox order placement failure (non-success status) throws and is caught by the outer handler, returning 500 — BackTestApp trade is never recorded
- **Category**: Negative
- **Priority**: P0
- **Steps**: Simulate Upstox rejecting the order (e.g., insufficient margin, invalid instrument)
- **Expected Result**: `placeOrders()` throws `Upstox order placement failed: <errors>`; the LIVE branch's `try` around `triggerBackTestApp` is only for the BackTestApp call itself — the Upstox throw happens BEFORE that try block, so it propagates to the route's outer catch, returning 500; correctly, NO BackTestApp trade record is created for a rejected broker order (consistent "broker-first" ordering design intent).

#### TC-PO-018: BackTestApp recording failure AFTER a successful LIVE Upstox fill is caught and logged, but the order is now "orphaned" (filled at broker, not recorded internally)
- **Category**: Negative / Regression
- **Priority**: P0
- **Steps**: Simulate BackTestApp being unreachable immediately after a successful Upstox order placement
- **Expected Result**: The inner `try/catch` around `triggerBackTestApp` in the LIVE branch (`server.js:L42-50`) catches this specific failure and logs it WITHOUT re-throwing — the request continues to `getLiveAccountBalance` and ultimately returns success-ish (`result`) to the caller. This means a real broker trade can exist with ZERO corresponding record in BackTestApp's ledger/trade history — a reconciliation gap with no retry/alerting mechanism.

### Audit Logging (Kafka) — Crash Risk

#### TC-PO-019: `storeOrderDetails` is fired without `await`/`.catch()` — a transient Kafka failure crashes the entire `placeorder` process
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #59
- **Steps**: Simulate a Kafka broker outage or `producer.send` rejection at the moment `storeOrderDetails(body.instrument_token, body)` is called (line 74, after the response-relevant work is done but before `res.send`)
- **Expected Result** (current bug): Since this call has no `await` and no `.catch()`, and `storeOrderDetails` is an `async function` that can reject (e.g., `producer.connect()` failure, or exhausting the `async-retry` 5 attempts), the rejection becomes an unhandled promise rejection. In Node.js ≥15, this terminates the process by default — crashing the ENTIRE `placeorder` service mid-flight, taking down ALL live order placement (not just the audit-log feature) due to a failure in what should be a non-critical logging path.
- **Notes**: Critical operational risk — a single Kafka blip during peak trading hours could kill the order-placement service for all users simultaneously. Verify actual crash behavior in a controlled test (kill Kafka broker connectivity right before this line fires) and confirm process exit.

#### TC-PO-020: `storeOrderDetails` creates a brand-new Kafka producer connection PER call (no connection reuse)
- **Category**: Performance / Regression
- **Priority**: P1
- **Related Issue**: #59
- **Steps**: Issue many sequential order requests; monitor Kafka client connection count/rate on the broker side
- **Expected Result**: A new `producer.connect()`/`disconnect()` cycle happens for every single order — under high order-throughput, this creates significant per-request overhead and connection churn compared to a long-lived, module-scoped producer.

#### TC-PO-021: `storeOrderDetails`'s internal LTP-enrichment failure is caught and does not prevent the Kafka publish (degrades to `null` ltp/symbol)
- **Category**: Negative (positive control)
- **Priority**: P2
- **Steps**: Simulate `fetchLTP` failing inside `storeOrderDetails`
- **Expected Result**: Caught locally, `order_details.ltp`/`Symbol_Name` set to `null`; the Kafka publish (with retry) still proceeds — this part IS correctly isolated; only the CALLER's lack of awaiting the overall promise (TC-PO-019) is the actual crash risk.

#### TC-PO-022: Kafka publish retries up to 5 times with 1s minimum backoff before giving up
- **Category**: Functional
- **Priority**: P2
- **Steps**: Simulate transient Kafka failures that resolve within the retry window
- **Expected Result**: `async-retry` with `retries:5, minTimeout:1000` eventually succeeds and the audit log is published; verify `onRetry` logging fires for each attempt.

### Outbound URL Construction (Injection Risk)

#### TC-PO-024: `symbol`/`userId` values containing `&` can inject/override query parameters in outbound LTP and funds/margin lookups
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #22
- **Steps**: Trigger an order (or any code path reaching `dependency.js`'s `fetchLTP`/`getLiveAccountBalance`) where `symbol` or `strategy_details.user_id` contains a raw `&userId=<other_id>` substring (e.g., a crafted `instrument_token` value like `"NSE_EQ|X&userId=victim"`)
- **Expected Result** (current bug): `fetchLTP`'s URL is built via raw template-string interpolation (`` `${NGINX_ADDRESS}/ltp?symbol=${symbol}&userId=${userId}` ``, `dependency.js:L29`) and `getLiveAccountBalance`'s URL similarly (`dependency.js:L165`) with NO `encodeURIComponent`/`URLSearchParams` escaping — a crafted `symbol` value containing an embedded `&userId=<attacker-chosen-id>` segment can inject/override the actual `userId` query parameter that the downstream `getLTP`/`FundsAndMargin` service receives, causing the LTP fetch or balance lookup to silently execute against a DIFFERENT user's context than the one the code believes it's querying for.
- **Notes**: Combined with `placeorder`'s complete lack of authentication (issue #14) and this parameter-injection gap, an attacker controlling any part of the `instrument_token`/`symbol` field (which flows into these interpolated URLs) has an additional vector for cross-user data access beyond the token-isolation/SDK-singleton bugs (#10/#16) — fix is straightforward (`encodeURIComponent` or `URLSearchParams` on all interpolated values) and should be verified with a payload containing `&`, `#`, and other URL-meaningful characters.

### Concurrency / Cross-Cutting

#### TC-PO-023: Two concurrent orders for two different users do not leak each other's access tokens (cross-reference to shared-SDK-singleton risk)
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #16
- **Steps**: Fire two simultaneous LIVE orders for different `user_id`s with different cached Upstox tokens; note `dependency.js`'s `placeOrders()` takes `access_token` as an explicit parameter (fetched via `getAccessTokenFromRedis(strategy_details.user_id)` BEFORE the call) — unlike `AuthoriseUpstoxClient.js`'s `getAuthorisedClient()` (used by the read-only market-data services), which mutates a shared singleton
- **Expected Result**: Confirm `placeorder`'s flow is NOT vulnerable to the cross-user token leakage described in issue #16, since it passes the token directly per-call rather than through the shared SDK singleton — this distinguishes `placeorder` from `getOrderBook`/`getLTP`/etc. Document this as a positive contrast in the test report.

#### TC-PO-025: `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate validation for all outbound HTTPS from `placeorder`
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #17
- **Steps**: Confirm `docker-compose.yml` sets `NODE_TLS_REJECT_UNAUTHORIZED: "0"` on the `placeorder` service; trace outbound HTTPS calls in `dependency.js`/`server.js` (Upstox HFT API, nginx-proxied `/ltp`, `/fundsandmargin`, BackTestApp `/api/trade`); optionally intercept with a self-signed MITM proxy on the Docker network
- **Expected Result** (current bug): Node accepts any server certificate without chain validation — a network-positioned attacker can present a forged cert and intercept/modify live order payloads, LTP lookups, funds/margin responses, and BackTestApp trade-recording calls. Cross-reference `infrastructure-docker-compose.md` TC-INF-023 for compose-level verification; this case confirms the runtime behavior specifically on the order-placement critical path.
