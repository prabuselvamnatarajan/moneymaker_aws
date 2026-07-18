# Nginx Reverse Proxy — Test Case Plan

## Scope
Covers `certs/nginx.conf`, the single public entry point (`reverse-proxy` service, host ports 80/443) that terminates TLS and proxies to all backend microservices/websocket services. Covers HTTP→HTTPS redirect, WS upgrade handling, per-route auth gaps, and missing HTTPS locations.

## Prerequisites
- Full stack running with `reverse-proxy` on ports 80/443
- `curl -k` (to accept self-signed cert) or a configured trust store
- A WebSocket client (e.g., `wscat`) for `/clientstreamer`, `/wsbacktest`, `/connectsocket`

## Test Cases

### HTTP → HTTPS Redirect

#### TC-NGX-001: Plain HTTP request to unmatched path redirects to HTTPS
- **Category**: Functional
- **Priority**: P1
- **Steps**: `curl -I http://localhost/anything`
- **Expected Result**: `301` redirect to `https://<host>/anything`

#### TC-NGX-002: `/clientstreamer` allowed over plain HTTP (port 80)
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #60
- **Steps**: Connect a WS client to `ws://localhost/clientstreamer`
- **Expected Result**: Connection succeeds unencrypted, proxied to `stream-to-client:8080` — ticks travel in plaintext.

#### TC-NGX-003: `/wsbacktest` allowed over plain HTTP (port 80)
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #27, #28
- **Steps**: Connect `ws://localhost/wsbacktest`
- **Expected Result**: Connection succeeds unencrypted to `backtest-streamer:8085`, publicly reachable without auth.

#### TC-NGX-004: `/backtestapp/` and `/backtest-ui/` accessible over both HTTP and HTTPS
- **Category**: Functional
- **Priority**: P2
- **Steps**: Request both paths via port 80 and port 443
- **Expected Result**: Both return expected content (both blocks define these locations identically).

### HTTPS Server Block Gaps

#### TC-NGX-005: `/clientstreamer` missing from HTTPS (443) server block
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #60
- **Steps**: Attempt `wss://localhost/clientstreamer` (secure WebSocket) against the 443 block
- **Expected Result** (bug): No matching `location` in the SSL server block — request falls through to default/404 or connection failure; a frontend served over HTTPS opening `wss://.../clientstreamer` fails, or if it opens `ws://` it is blocked by browser mixed-content policy.
- **Notes**: This breaks all real-time price ticks for HTTPS-served frontends. Verify with a browser dev console mixed-content error as well as raw curl/wscat.

#### TC-NGX-006: `/wsbacktest` IS present in both HTTP and HTTPS blocks
- **Category**: Regression (positive control)
- **Priority**: P2
- **Steps**: Confirm `location /wsbacktest` exists in both `listen 80` and `listen 443 ssl` blocks
- **Expected Result**: Present in both — contrast with TC-NGX-005 to show the asymmetry is specific to `/clientstreamer`.

### Public Route Inventory & Authentication

#### TC-NGX-007: `/placeorder` reachable without any credentials
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #14
- **Steps**: `curl -k -X POST https://localhost/placeorder -d '{...valid order body...}' -H 'Content-Type: application/json'`
- **Expected Result** (bug): Request is proxied straight to `placeorder:80` with zero authentication at nginx or app layer; a well-formed body places a real/paper order for any `user_id`.

#### TC-NGX-008: `/orderbook`, `/ltp`, `/ohlc`, `/fullmarketquote`, `/putcalloptionchain`, `/optioncontracts`, `/fundsandmargin` unauthenticated
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #14
- **Steps**: `curl -k https://localhost/<each path>?...` with no auth headers, varying `userId` query param
- **Expected Result** (bug): All return data for any supplied `userId` with no verification the caller owns that identity.

#### TC-NGX-009: `/connectsocket` unauthenticated trigger of WS ingestion
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #14, #26
- **Steps**: `curl -k https://localhost/connectsocket` with no auth
- **Expected Result**: Triggers `connect-upstox-web-socket` subscription flow with no credential check.

#### TC-NGX-010: `/logedin` (UpstoxLogin) reachable via HTTPS proxy
- **Category**: Functional
- **Priority**: P1
- **Steps**: `curl -k https://localhost/logedin`
- **Expected Result**: Proxies to `upstock-login:80`; cross-check against TC-NGX-011 (direct port).

#### TC-NGX-011: UpstoxLogin also directly reachable on host port 8080, bypassing proxy entirely
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #25
- **Steps**: `curl http://<host>:8080/` directly
- **Expected Result** (bug): Service responds over plain HTTP with no TLS and no path-based routing restrictions, completely bypassing nginx.

#### TC-NGX-012: `/backtest` (BacktestClient) public and unauthenticated, trusts client `deployment_id`
- **Category**: Security
- **Priority**: P0
- **Related Issue**: #28
- **Steps**: `curl -k "https://localhost/backtest?deployment_id=<victim_id>&run_id=1&symbolName=RELIANCE&..."`
- **Expected Result** (bug): Request accepted with no `BACKTEST_SERVICE_TOKEN`/JWT check; can inject fabricated ticks tagged with another user's `deployment_id`.

### TLS / Certificate Handling

#### TC-NGX-013: Self-signed certificate is served and accepted only with `-k`/trust override
- **Category**: Security
- **Priority**: P2
- **Steps**: `curl https://localhost/` without `-k`
- **Expected Result**: TLS verification failure (untrusted self-signed cert) — expected for this environment; verify cert CN/SAN matches `server_name localhost`.

#### TC-NGX-014: `ssl_protocols`/`ssl_ciphers` restrict to modern TLS
- **Category**: Security
- **Priority**: P2
- **Steps**: Run `nmap --script ssl-enum-ciphers -p 443 localhost` or `openssl s_client -connect localhost:443 -tls1_1`
- **Expected Result**: TLSv1.2/1.3 only accepted; TLSv1.1 and below rejected; weak ciphers (aNULL/MD5) rejected per `ssl_ciphers HIGH:!aNULL:!MD5`.

### Header Propagation & WebSocket Upgrade

#### TC-NGX-015: `X-Forwarded-For`/`X-Real-IP` correctly propagated
- **Category**: Functional
- **Priority**: P2
- **Steps**: Send request with a custom `X-Forwarded-For`; inspect what backend service logs/receives
- **Expected Result**: Headers set by nginx as configured; verify backend services don't blindly trust `X-Forwarded-For` for auth decisions (they shouldn't, since there is no auth at all currently).

#### TC-NGX-016: WebSocket `Upgrade`/`Connection` headers correctly forwarded on all WS locations
- **Category**: Functional
- **Priority**: P1
- **Steps**: Connect WS clients to `/clientstreamer`, `/wsbacktest` (HTTP), inspect `proxy_read_timeout 3600s` behavior on long-idle connections
- **Expected Result**: Connections upgrade successfully and remain open beyond typical idle timeouts (up to 3600s) without nginx closing them.

#### TC-NGX-017: No security headers (HSTS, X-Frame-Options, CSP) set by nginx
- **Category**: Security
- **Priority**: P2
- **Related Issue**: #23
- **Steps**: `curl -kI https://localhost/backtest-ui/`
- **Expected Result** (gap): No `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, or CSP headers present.

### Missing Rate Limiting at Proxy Layer

#### TC-NGX-018: No rate limiting (`limit_req`) configured on any location
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #23, #37
- **Steps**: Fire N rapid sequential requests at `/placeorder` or `/logedin`
- **Expected Result** (gap): No `429` responses ever returned; nginx applies no throttling, consistent with app-layer having none either.
