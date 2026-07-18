# MicroService: UpstoxLogin (OAuth) & Token Management — Test Case Plan

## Scope
Covers `MicroServices/UpstoxLogin` (`server.js` + `login.js`), the OAuth 2.0 authorization-code flow with Upstox, and the shared `AuthoriseUpstoxClient.js` token-retrieval/caching module (`MicroServices/Shared/AuthorisedUpstox`) used by every other microservice that talks to Upstox. Covers broker-credential persistence in MongoDB, Redis token caching (per-user and global-default keys), token expiry detection, and the exposed host port.

## Prerequisites
- A test Upstox developer app (or mocked Upstox OAuth/token endpoints) with known `client_id`/`client_secret`/`redirect_uri`
- MongoDB `BacktestApp.brokers` collection with at least one seeded `external_broker_id:"upstox"` broker document (with and without a `user_id`, for different test scenarios)
- Redis reachable for token caching
- Ability to call `UpstoxLogin` both through nginx (TLS) and directly on host port 8080 (plain HTTP)

## Test Cases

### OAuth Initiation

#### TC-UPX-001: `GET /` with no `code` redirects to Upstox's authorization dialog using the broker's stored `client_id`/`redirect_uri`
- **Category**: Functional
- **Priority**: P0
- **Steps**: `GET /` with `userId=<seeded user>`, no `code`
- **Expected Result**: 302/redirect response to `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=<id>&redirect_uri=<uri>&state=<userId>` (URL-encoded).

#### TC-UPX-002: `GET /` with no `userId` uses the global (userId-less) broker query and omits `state`
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /` with no `userId` query param
- **Expected Result**: `start_app_upstox('')` queries `{external_broker_id:'upstox'}` (no `user_id` filter — matches ANY upstox broker doc, potentially the wrong one if multiple exist); redirect URL omits `&state=`.

#### TC-UPX-003: No matching broker configuration for the given `userId` returns 500 with a clear internal error
- **Category**: Negative
- **Priority**: P1
- **Steps**: `GET /` with `userId=<user with no upstox broker configured>`
- **Expected Result**: `start_app_upstox` throws `Upstox broker configuration not found for user: <id>`; caught by `server.js`'s route handler, returns `500 Internal Server Error: <message>` — verify the raw error message (potentially containing the user ID) isn't excessively revealing to an unauthenticated caller (this endpoint has no auth, per issue #14's broader pattern, though not explicitly listed for this route).

#### TC-UPX-004: Broker document missing `client_id`/`redirect_uri` in `credentials` returns 500
- **Category**: Negative
- **Priority**: P2
- **Steps**: Seed a broker doc with `credentials:{}` (empty)
- **Expected Result**: `client_id and redirect_uri must be defined in broker credentials.` thrown and surfaced as 500.

### OAuth Callback — `state` Trust (Critical Security)

#### TC-UPX-005: `GET /?code=<valid>&state=<userId>` completes the flow and stores the token under that `userId`
- **Category**: Functional
- **Priority**: P0
- **Steps**: Complete a real (or mocked) OAuth round-trip with a valid `code` and `state` matching an actual user
- **Expected Result**: `get_new_access_token(code, state)` fetches the token, upserts the `brokers` collection for that `user_id`, caches it in Redis at `redis_upstox_access_token:<userId>`, publishes a `broker_updated` event, returns "Success!!!".

#### TC-UPX-006: `state` is trusted as the target user identity with NO cryptographic verification — attacker can hijack ANY victim's broker credentials
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #15
- **Steps**: As Attacker, initiate their OWN legitimate OAuth flow with Upstox using their OWN Upstox account/credentials (e.g., via `GET /?userId=attacker`, completing Upstox's real consent screen as themselves) — but intercept/craft the final callback redirect to instead call `GET /?code=<attacker's real valid code>&state=<victim_user_id>`
- **Expected Result** (current bug): `server.js` passes `state` directly as `userId` into `get_new_access_token(code, state)` with zero validation that this `state` was actually issued by `start_app_upstox` for this session/user, and no CSRF nonce binding it to the original request. `checkAndUpdateCredentials` then either UPDATES the victim's existing `brokers` document (overwriting `access_token` with the attacker's own valid Upstox token, keeping the victim's OTHER credential fields) or, if the victim had no existing broker doc, inserts one using the ATTACKER's `client_id`/`client_secret`/`redirect_uri` (from the attacker's OWN OAuth initiation) but tagged with the VICTIM's `user_id`. Either way, subsequent live trades placed under the victim's `user_id` now execute against the ATTACKER's Upstox account/credentials — full broker-account hijack. Confirm end-to-end: victim's `user_id` broker doc after the attack has `access_token` usable to place orders that settle in the attacker's own brokerage account, NOT the victim's.
- **Notes**: This is a critical, remotely-exploitable account-takeover vulnerability. Recommended fix per issues.md: bind `state` to a signed, single-use, session-scoped token generated during an AUTHENTICATED `start_app_upstox` call, and verify that signature/binding before trusting `state` as a user identity in the callback.

#### TC-UPX-007: Missing `code` on the callback path is handled by treating the request as an initiation (no error)
- **Category**: Functional (edge case)
- **Priority**: P2
- **Steps**: `GET /` with neither `code` nor a meaningful `state`, e.g. accidental double-navigation to the callback URL
- **Expected Result**: `server.js`'s `if (code)` branch is skipped entirely; falls through to the `else` (initiation) branch, redirecting to Upstox's dialog again — potentially confusing but not an error.

#### TC-UPX-008: Invalid/expired `code` from Upstox returns 500 with the underlying token-exchange error
- **Category**: Negative
- **Priority**: P1
- **Steps**: Send a `code` that Upstox rejects (already used, expired, malformed)
- **Expected Result**: `get_new_access_token` catches the axios failure, throws `Failed to obtain access token...`; surfaced as 500 by `server.js`.

#### TC-UPX-009: Upstox response with a malformed/missing `access_token` field is explicitly rejected before any credential write
- **Category**: Negative (positive control)
- **Priority**: P1
- **Steps**: Mock Upstox's token endpoint to return `{}` or `{access_token: 12345}` (non-string)
- **Expected Result**: `if (!response.data || typeof response.data.access_token !== 'string')` guard throws BEFORE `checkAndUpdateCredentials`/`setAccessTokenInRedis` are called — no partial/corrupt credential write occurs.

### Credential Persistence & Token Caching

#### TC-UPX-010: Existing broker document is updated (access_token + created_at only) rather than replaced
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete OAuth for a `userId` that already has a `brokers` doc
- **Expected Result**: `updateOne` with `$set:{access_token, created_at}` — other fields (`name`, `credentials.client_id/secret/redirect_uri`) are preserved unchanged from the existing document.

#### TC-UPX-011: New broker document defaults `is_internal:false` and stores full credentials including `client_secret` in plaintext
- **Category**: Regression / Security
- **Priority**: P1
- **Related Issue**: #29 (cross-reference)
- **Steps**: Complete OAuth for a `userId` with no existing broker doc
- **Expected Result**: New document inserted with `is_internal:false`, `credentials:{client_id, client_secret, redirect_uri}` stored as-is (plaintext, no encryption) — cross-reference `BackTestApp-brokers-users-admin.md`'s broker-secrets-masking tests; this is the write-side origin of that plaintext-secret data.

#### TC-UPX-012: Successful token acquisition mirrors the per-user token into the SHARED GLOBAL default Redis key (Token Isolation Break, part 1)
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #10
- **Steps**: User A completes OAuth successfully; inspect Redis keys `redis_upstox_access_token:A` and the bare `redis_upstox_access_token` (no suffix)
- **Expected Result** (current bug): `setAccessTokenInRedis` sets BOTH `redis_upstox_access_token:A` (correct, scoped) AND unconditionally overwrites the global `redis_upstox_access_token` key with A's token (`login.js:L178-181`, guarded only by `if (userId)`, i.e. this happens for EVERY successful per-user login). If User B subsequently completes their own OAuth, B's token now overwrites the global default — the global fallback key silently becomes "whichever user logged in most recently," with no relation to any specific caller's intent.

#### TC-UPX-013: Two users sequentially completing OAuth causes the SECOND user's token to become the de-facto default for ALL callers that omit `userId`
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #10
- **Steps**: User A completes OAuth, then User B completes OAuth; then call any read-only market-data microservice (e.g., `getLTP`) with NO `userId` query param
- **Expected Result** (current bug): The request resolves to `DEFAULT_REDIS_KEY` (`redis_upstox_access_token`), which now holds User B's token (the most recent overwrite) — any caller omitting `userId` (or explicitly passing `userId=''`/`'default'`) transparently operates against User B's Upstox account, regardless of which user's data was intended.

### Token Fallback / Cross-User Leakage (Critical Security)

#### TC-UPX-014: `getAccessTokenFromRedis(userId)` with a missing/expired per-user token SCANS ALL other users' tokens and returns the first valid one found (Token Isolation Break, part 2)
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #10
- **Steps**: User C has no cached token (never logged in, or their token was deleted after expiry); User D has a valid, non-expired cached token at `redis_upstox_access_token:D`; call `getAccessTokenFromRedis('C')`
- **Expected Result** (current bug): `redisString.get('redis_upstox_access_token:C')` returns null; the fallback block runs `client.keys('redis_upstox_access_token:*')`, iterates ALL matching keys, and returns the FIRST valid (non-expired) token it finds — in this case, User D's token — as if it were User C's. Any subsequent call using this token (e.g., `placeorder` with `user_id:'C'`) will execute against User D's real Upstox brokerage account. Combined with the complete lack of authentication on `/placeorder` (issue #14), an anonymous attacker can supply ANY arbitrary/guessed `user_id` (even one with no broker ever configured) and have their order silently execute against WHICHEVER other user's token the scan happens to find first.
- **Notes**: This is arguably the most severe token-handling bug in the codebase — it converts "my token expired" into "silently trade on a stranger's account." The `client.keys()` SCAN-equivalent call is also a Redis performance concern under many cached users.

#### TC-UPX-015: If the per-user AND all-users-scan both miss, falls back a THIRD time to the bare global default key
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #10
- **Steps**: User E has no per-user token, and no other user has any cached token (scan finds nothing); global default key currently holds User B's token (from TC-UPX-013)
- **Expected Result**: Third fallback (`redisString.get(DEFAULT_REDIS_KEY)`) returns User B's token — User E's request now executes as User B, yet another cross-user substitution, layering on top of the part-1/part-2 bugs above.

#### TC-UPX-016: Expired token triggers deletion of BOTH the resolved key and (if different) the global default key
- **Category**: Functional (partially correct behavior)
- **Priority**: P1
- **Steps**: Seed an expired JWT-format token (`exp` in the past, or within the 60s skew) at a per-user key; request it
- **Expected Result**: `isUpstoxTokenExpired` detects expiry; `deleteExpiredToken` removes the per-user key AND additionally deletes the global default key (`if (resolvedKey !== DEFAULT_REDIS_KEY) deleteExpiredToken(DEFAULT_REDIS_KEY)`) — note this means ONE user's expired token deletion also wipes the GLOBAL fallback for everyone else, a further cross-user side effect (if the global key happened to hold a DIFFERENT, still-valid user's token, it is destroyed collaterally).

#### TC-UPX-017: Malformed (non-JWT) token string is treated as expired defensively
- **Category**: Negative
- **Priority**: P2
- **Steps**: Seed a garbage string (not JWT-shaped) as a cached token
- **Expected Result**: `isUpstoxTokenExpired` catches the parse failure (or the `parts.length < 2` guard) and returns `true` — treated safely as expired/invalid, triggering cleanup rather than being used as-is.

#### TC-UPX-018: `userId==='default'` is normalized to the empty-string (global) key, not a literal `redis_upstox_access_token:default` key
- **Category**: Functional
- **Priority**: P2
- **Steps**: Call `getAccessTokenFromRedis('default')`
- **Expected Result**: `cleanUserId = (userId==='default') ? '' : userId` — resolves directly to the bare global key, skipping the per-user key entirely.

### Shared SDK Singleton (Cross-Reference)

#### TC-UPX-019: `getAuthorisedClient` mutates a MODULE-LEVEL singleton `UpstoxClient.ApiClient.instance` shared by every concurrent request across ALL consumers of this shared module
- **Category**: Security / Critical Bug
- **Priority**: P0
- **Related Issue**: #16
- **Steps**: Fire two near-simultaneous requests to any two of `getLTP`/`getOHLC`/`fullMarketQuote`/`getOrderBook`/`FundsAndMargin`/option-chain services for two DIFFERENT `userId`s with different valid cached tokens (each of these services imports its OWN copy of `AuthoriseUpstoxClient.js` per microservice container, so this specific race is scoped to concurrent requests WITHIN a single microservice's process, not across different microservices)
- **Expected Result** (current bug): `getAuthorisedClient(userId)` does `defaultClient.authentications['OAUTH2'].accessToken = access_token;` on the SDK's shared `ApiClient.instance` — under concurrent async execution within one process, Request A sets the token for User A, then before A's actual `apiInstance.getXyz(...)` callback fires, Request B's `getAuthorisedClient` call overwrites the SAME global `accessToken` with User B's token. When A's deferred SDK call finally executes, it uses whatever token is CURRENTLY set (User B's), returning/acting on User B's Upstox data/account under User A's request. Reproduce with a tight concurrency test (e.g., 50 parallel requests alternating `userId=A`/`userId=B` against `getLTP`) and check for cross-contaminated responses (verify via a mock Upstox endpoint that logs which token was presented for which logical request).
- **Notes**: See `microservice-market-data.md` and `microservice-orders-options.md` for the consumer-side tests of this same root cause across each affected read endpoint.

### Network Exposure

#### TC-UPX-020: `UpstoxLogin` is directly reachable on host port 8080 over plain HTTP, bypassing the TLS-terminating nginx reverse proxy entirely
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #25
- **Steps**: From outside the Docker network, connect directly to `<host>:8080/` (not through 80/443)
- **Expected Result** (current bug): Connection succeeds in plaintext HTTP — OAuth `code` values, resulting access tokens (in the "Success!!!" response path, not directly returned but processed), and MongoDB broker-credential writes triggered by this plaintext channel have no TLS protection; this is the only microservice with a direct host port mapping (`8080:80` per `docker-compose.yml:L491-492`), inconsistent with every other service which is reachable only through the nginx-proxied network.

#### TC-UPX-021: Requests through nginx (443) and requests directly to port 8080 produce IDENTICAL application behavior (proxy adds no auth)
- **Category**: Security
- **Priority**: P2
- **Related Issue**: #25, #14
- **Steps**: Issue the same OAuth-initiation request through both paths
- **Expected Result**: Confirms nginx provides no additional authentication/authorization for this service beyond TLS termination — the direct port exposure is a pure downgrade (loses TLS) with no compensating control lost, reinforcing that removing the port mapping is a safe, low-risk fix.
