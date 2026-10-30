# MicroServices: Market Data (getLTP, getOHLC, fullMarketQuote) — Test Case Plan

## Scope
Covers the three read-only market-quote microservices (`MicroServices/market-quote/getLTP`, `getOHLC`, `fullMarketQuote`), each a thin Express wrapper around the Upstox `MarketQuoteV3Api`/`MarketQuoteApi` SDK, exposed publicly via nginx at `/ltp`, `/ohlc`, `/fullmarketquote`. All three share the exact same `getAuthorisedClient`/`resetAuthorisedClient` pattern from `AuthoriseUpstoxClient.js`.

## Prerequisites
- Valid, non-expired Upstox access tokens cached in Redis for at least two distinct test `userId`s (to test cross-user singleton contamination)
- Reachable (or mocked) Upstox market-quote API
- Access to all three services directly and through nginx

## Test Cases

### getLTP

#### TC-MD-001: Valid `symbol`+`userId` returns the last traded price
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_EQ|INE002A01018&userId=<valid>`
- **Expected Result**: 200 with Upstox's LTP payload for the requested instrument.

#### TC-MD-002: Missing `symbol` defaults to `NSE_INDEX|Nifty 50`
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /?userId=<valid>` (no `symbol`)
- **Expected Result**: LTP fetched for the Nifty 50 index — verify this hardcoded default is intentional/documented behavior, not an oversight that silently serves wrong data to a caller who forgot the param.

#### TC-MD-003: Missing/empty `userId` resolves to the GLOBAL default token (cross-reference token isolation issue)
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #10
- **Steps**: `GET /?symbol=X` with no `userId`
- **Expected Result**: `getAuthorisedClient('')` → `getAccessTokenFromRedis('')` resolves to the bare `redis_upstox_access_token` key, which per issue #10 reflects whichever user most recently completed OAuth — NOT a neutral "no user" state; document actual behavior.

#### TC-MD-004: Upstox API error triggers `resetAuthorisedClient()` and a 500
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate the Upstox SDK callback invoking `error`
- **Expected Result**: `resetAuthorisedClient()` clears the module-level `authorisedClient` cache to force re-authorization on the next call; response is `500 Internal Server Error` with no leaked internal error detail to the client (server-side `console.error` only).

#### TC-MD-005: No cached/valid token for the requested user (and no fallback found) results in `getAuthorisedClient` throwing before the SDK call is even attempted
- **Category**: Negative
- **Priority**: P1
- **Steps**: `GET /?symbol=X&userId=<user with no token, and no valid tokens exist anywhere in Redis>`
- **Expected Result**: `getAccessTokenFromRedis` returns `null`; `defaultClient.authentications['OAUTH2'].accessToken = null` is set; the subsequent Upstox call fails with an auth error from Upstox itself (not a clean local validation error) — verify the resulting error message/status is still handled gracefully (caught by the outer catch, 500 returned) rather than crashing.

### getOHLC

#### TC-MD-006: Valid `symbol`+`interval`+`userId` returns OHLC candle data
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_EQ|INE002A01018&interval=I1&userId=<valid>`
- **Expected Result**: 200 with Upstox OHLC payload for the 1-minute interval.

#### TC-MD-007: Missing `interval` defaults to `I1`
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /?symbol=X&userId=<valid>` (no `interval`)
- **Expected Result**: Defaults applied; request succeeds with 1-minute interval data.

#### TC-MD-008: Invalid `interval` value (not an Upstox-recognized enum) is forwarded as-is and fails at the Upstox layer
- **Category**: Negative
- **Priority**: P2
- **Steps**: `GET /?symbol=X&interval=BOGUS&userId=<valid>`
- **Expected Result**: No local validation of `interval` — Upstox itself rejects it; local service surfaces this as a generic 500 rather than a descriptive 400 (missed opportunity for clearer client-side error feedback).

### fullMarketQuote

#### TC-MD-009: Valid `symbol`+`userId` returns the full market quote (v2 API)
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /?symbol=NSE_EQ|INE002A01018&userId=<valid>`
- **Expected Result**: 200 with full quote payload (bid/ask depth, OI, etc. per Upstox v2 schema).

#### TC-MD-010: Hardcoded `apiVersion="2.0"` is not configurable — verify compatibility as Upstox evolves API versions
- **Category**: Regression
- **Priority**: P2
- **Steps**: Review whether Upstox has deprecated/changed v2.0 market-quote behavior since this was written
- **Expected Result**: Document current compatibility; flag as a maintenance risk if Upstox sunsets v2.0 while other services in this codebase (`getLTP`/`getOHLC`) use v3.

### Unauthenticated Public Access (Critical Security, shared across all three)

#### TC-MD-011: All three market-data endpoints are reachable with ZERO authentication through the public nginx proxy
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #14
- **Steps**: As an anonymous internet caller (no `Authorization` header, no session, no API key), call `GET /ltp?symbol=X&userId=<any known user>`, `/ohlc?...`, `/fullmarketquote?...` through the public HTTPS nginx endpoint
- **Expected Result** (current bug): All three requests succeed fully — nginx performs no auth (`certs/nginx.conf:L139-158`), and none of the three Express apps implement any authentication middleware. Any caller can read ANY user's market data by supplying that user's `userId`, and since `userId` is just an arbitrary string with no ownership verification, this also serves as a way to probe/enumerate which `userId` values have valid cached Upstox tokens (via response success/failure patterns) — informing further attacks like those in `microservice-placeorder.md` TC-PO-010.

#### TC-MD-012: Repeated rapid unauthenticated requests are not rate-limited at either the nginx or application layer
- **Category**: Security / Performance
- **Priority**: P1
- **Related Issue**: #14
- **Steps**: Fire a burst of requests (e.g., 100/sec) against `/ltp` with varying `symbol`/`userId` combinations
- **Expected Result**: No 429s or throttling observed — confirms these endpoints (which proxy to Upstox's own rate-limited API) can be used to exhaust the underlying Upstox API quota for whichever user's token is resolved, potentially locking legitimate live-trading strategies out of market data.

### Shared SDK Singleton Cross-User Contamination (Critical Security, shared across all three)

#### TC-MD-013: Concurrent requests for different `userId`s on the SAME service instance can return one user's data attributed to another's request
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #16
- **Steps**: Within a single `getLTP` (or `getOHLC`/`fullMarketQuote`) container instance, fire two overlapping requests: Request A for `userId=alice` (valid token) and Request B for `userId=bob` (different valid token), timed so that B's `getAuthorisedClient` call lands between A's token-set and A's actual SDK callback invocation
- **Expected Result** (current bug): Because `getAuthorisedClient` mutates the SDK's shared `UpstoxClient.ApiClient.instance` singleton rather than creating a per-request client instance, Request A's eventual LTP/OHLC/quote data reflects Bob's Upstox session context (rate limits, account-specific entitlements, or in more severe SDK/API variants, account-specific data) rather than Alice's — under sustained concurrent load (multiple deployments hitting this shared service simultaneously via `PLACEORDER_API`-adjacent flows or dashboard polling), this could systematically misattribute market-data responses. Reproduce via a controlled interleaving test (e.g., inject an artificial delay in the mocked Upstox callback for Request A to widen the race window) and confirm the returned payload/token used doesn't match the originally requested `userId`.
- **Notes**: Since market-quote data is often NOT truly user-specific (LTP for a symbol is the same regardless of who asks), the practical impact of this specific issue is lower for market-data endpoints than for `getOrderBook`/`FundsAndMargin` (which ARE genuinely per-account) — but it still represents a correctness/security anti-pattern and a genuine risk if Upstox ever returns user-scoped rate-limit errors or entitlement-based quote restrictions tied to the wrong account.

#### TC-MD-014: `resetAuthorisedClient()` on error only nulls the local module cache reference — it does NOT revert the SDK's global singleton token to any previous value
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #16
- **Steps**: Trigger an error path (TC-MD-004) then immediately issue a fresh valid request
- **Expected Result**: The next call re-invokes `getAuthorisedClient`, re-setting the singleton token freshly — confirms `resetAuthorisedClient` is a narrow, local-only reset (sets `authorisedClient = null` so the NEXT call re-derives a client) rather than any kind of broader mutex/lock release; it does not prevent a DIFFERENT concurrent in-flight request from having already raced against this one.

### Cross-Service Consistency

#### TC-MD-015: All three services independently import their own copy of `AuthoriseUpstoxClient.js` — verify there is exactly ONE canonical shared source file, not silently drifted copies
- **Category**: Regression
- **Priority**: P2
- **Steps**: Diff `redis_utils/AuthoriseUpstoxClient.js` as vendored/copied into `getLTP`, `getOHLC`, `fullMarketQuote`, `getOrderBook`, `FundsAndMargin`, and the option-chain services
- **Expected Result**: Confirm all copies are byte-identical to `shared/AuthorisedUpstox/AuthoriseUpstoxClient.js` (the intended shared source) — flag any service whose local copy has silently diverged (e.g., due to a partial fix applied to only some services), which would mean issue #10/#16 fixes need to be replicated everywhere rather than fixed once centrally.
