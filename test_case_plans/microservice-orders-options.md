# MicroServices: Order Book, Funds/Margin, Option Chain/Contracts — Test Case Plan

## Scope
Covers the remaining Upstox-backed read/account microservices: `MicroServices/Orders/getOrderBook`, `MicroServices/Users/FundsAndMargin`, `MicroServices/Option-Chain/option-contracts`, `MicroServices/Option-Chain/put-call-option-chain`. All follow the identical `getAuthorisedClient(userId)` → SDK-call → response pattern as the market-data services, but expose genuinely account-scoped data (order book, funds/margin) where cross-user contamination (issue #16) is most impactful.

## Prerequisites
- Valid, non-expired Upstox tokens cached for at least two distinct test users with DIFFERENT actual order books / fund balances (to make cross-contamination detectable)
- Reachable (or mocked) Upstox `OrderApi`, `UserApi`, `OptionsApi` endpoints
- Access to all four services directly and through nginx (`/orderbook`, `/fundsandmargin`, `/optioncontracts`, `/putcalloptionchain`)

## Test Cases

### getOrderBook

#### TC-OO-001: Valid `userId` returns that user's current order book from Upstox
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?userId=<valid, has open/recent orders>`
- **Expected Result**: 200 with Upstox's order-book array for that user's account.

#### TC-OO-002: Missing `userId` resolves to the shared global default token
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #10
- **Steps**: `GET /` with no `userId`
- **Expected Result**: Returns whichever user's token currently occupies `redis_upstox_access_token` (per issue #10) — an unrelated caller's order book could be exposed to whoever omits `userId`.

#### TC-OO-003: Concurrent order-book requests for two different users can cross-contaminate due to the shared SDK singleton — HIGH IMPACT for this endpoint specifically
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #16
- **Steps**: Fire near-simultaneous `GET /?userId=alice` and `GET /?userId=bob` requests against the same service instance, with a mocked Upstox `getOrderBook` callback delay long enough to widen the race window
- **Expected Result** (current bug): Because order book contents are ENTIRELY account-specific (unlike LTP, which is symbol-specific and identical for everyone), this is the highest-impact manifestation of issue #16 — Alice's request can return Bob's actual order history/open orders, and vice versa, a direct cross-user data leak of sensitive trading information. Verify definitively by seeding Alice and Bob with distinctly different, identifiable order records and confirming which user's data comes back under contention.

#### TC-OO-004: Upstox API error resets the shared client and returns 500 with no order data leaked
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate an Upstox order-book API error
- **Expected Result**: `resetAuthorisedClient()` called; 500 returned; no partial/stale order data included in the error response.

### FundsAndMargin

#### TC-FM-001: Valid `userId` returns that user's funds and margin details
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?userId=<valid>`
- **Expected Result**: 200 with `getUserFundMargin` response including `equity.availableMargin` (the exact field `placeorder`'s `dependency.js#getLiveAccountBalance` depends on).

#### TC-FM-002: This endpoint is the sole dependency for `placeorder`'s post-LIVE-order balance sync — verify field shape stability
- **Category**: Regression
- **Priority**: P1
- **Steps**: Cross-check the response shape consumed by `dependency.js#getLiveAccountBalance` (`data.equity.availableMargin`) against this service's actual current response structure
- **Expected Result**: Confirms no schema drift; if Upstox changes this response shape, `placeorder`'s balance sync would silently break (accessing `undefined.availableMargin` would throw, caught by `placeorder`'s outer catch per `microservice-placeorder.md` TC-PO-015, causing 500s on every successful LIVE order).

#### TC-FM-003: Cross-user contamination risk — Funds/margin data is account-specific and highly sensitive (balance/leverage information)
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #16
- **Steps**: Same concurrent-request methodology as TC-OO-003, applied to `FundsAndMargin`
- **Expected Result**: Same class of bug — under concurrent load, User A's balance-check (or `placeorder`'s automatic post-trade balance sync, which calls this exact endpoint) can retrieve and cache User B's actual account balance into User A's Redis-cached balance key, corrupting the deployment's displayed/tracked account balance with another user's real financial data.

#### TC-FM-004: Missing `userId` behavior is consistent with other services (falls back to global default token)
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #10
- **Steps**: `GET /` with no `userId`
- **Expected Result**: Consistent fallback behavior; document for completeness.

### Option Contracts

#### TC-OC-001: Valid `symbol` (and optional `expiry`) returns the option contract chain for the underlying
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_INDEX|Nifty 50&expiry=2024-06-27&userId=<valid>`
- **Expected Result**: 200 with Upstox option-contracts payload filtered to the given expiry.

#### TC-OC-002: Omitted `expiry` fetches contracts across all available expiries (or Upstox's own default)
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /?symbol=X&userId=<valid>` (no `expiry`)
- **Expected Result**: `options = expiry ? {expiryDate:expiry} : null` — passes `null` options to the SDK, relying on Upstox's own default behavior for an unscoped request; document actual returned range.

#### TC-OC-003: Default `symbol` is `NSE_INDEX|Nifty 50` when omitted, consistent with market-data services
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /?userId=<valid>` (no `symbol`)
- **Expected Result**: Defaults applied; confirms consistency of default-symbol convention across all quote/option services (useful for UI dropdown default-population testing, see `BackTestUI.md`).

#### TC-OC-004: Invalid/malformed `expiry` (not `YYYY-MM-DD`) is forwarded to Upstox without local validation
- **Category**: Negative
- **Priority**: P2
- **Steps**: `GET /?symbol=X&expiry=notadate&userId=<valid>`
- **Expected Result**: No local format validation — Upstox rejects it; local service surfaces a generic 500.

### Put-Call Option Chain

#### TC-PCC-001: Valid `symbol`+`expiry` returns the full put-call option chain
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_INDEX|Nifty 50&expiry=2024-06-27&userId=<valid>`
- **Expected Result**: 200 with paired CE/PE strike data for the given expiry.

#### TC-PCC-002: Missing `expiry` is passed through as `undefined` to the SDK (no default applied, unlike `option-contracts`)
- **Category**: Regression
- **Priority**: P1
- **Steps**: `GET /?symbol=X&userId=<valid>` (no `expiry`)
- **Expected Result**: `req.query.expiry` is `undefined`, passed directly to `getPutCallOptionChain(symbol, undefined, callback)` — verify Upstox's behavior for a missing required expiry parameter (likely a 400-class error from Upstox itself, surfaced as a local 500); note the inconsistency with `option-contracts`, which explicitly handles the missing-expiry case with a `null` fallback.

#### TC-PCC-003: Shared SDK singleton risk applies identically to this endpoint under concurrent multi-user load
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #16
- **Steps**: Same concurrency methodology as TC-OO-003
- **Expected Result**: Lower practical severity than order-book/funds (option chain data isn't account-specific), but still confirms the systemic pattern — flag as part of the aggregate fix scope (a single fix to `AuthoriseUpstoxClient.js` — per-request client instantiation — resolves this across ALL SIX affected services at once).

### Cross-Cutting: Unauthenticated Access

#### TC-OO-FM-OC-001: All four endpoints are exposed publicly via nginx with zero authentication
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #14
- **Steps**: Anonymously call `/orderbook`, `/fundsandmargin`, `/optioncontracts`, `/putcalloptionchain` through the public nginx endpoint with an arbitrary/guessed `userId`
- **Expected Result**: All succeed with no credentials — an anonymous caller can read any guessable user's order history and account balance/margin (the two most sensitive data types in this entire microservice tier), and read option-chain data (lower sensitivity) with no restriction. Cross-reference `microservice-market-data.md` TC-MD-011 for the shared root cause and remediation.
