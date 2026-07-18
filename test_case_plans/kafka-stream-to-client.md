# `stream-to-client` — Live/Backtest Tick WebSocket Fan-out — Test Case Plan

## Scope
A standalone WebSocket server (`kafka/services/streamToClient/wsServer.js`, port 8080 internally) that bridges Redis pub/sub channels (`live:<symbol>` / `backtest:<symbol>`) to browser WebSocket clients. Frontend clients subscribe/unsubscribe to symbol+mode channels; the server dynamically subscribes/unsubscribes to the corresponding Redis channel only while at least one socket cares, minimizing Redis subscription overhead. Exposed publicly via nginx `/clientstreamer` (HTTP only — see `infrastructure-nginx-reverse-proxy.md` TC-NGX-005 for the missing HTTPS location).

## Prerequisites
- Redis reachable with `wsdatasplitter-consumer` (live) or backtest-tick-producing service actively publishing to `live:<symbol>`/`backtest:<symbol>` channels
- A raw WebSocket client (e.g., `wscat`) to connect directly to the service or via nginx `/clientstreamer`

## Test Cases

### Subscribe / Unsubscribe Lifecycle

#### TC-STC-001: Subscribing to a live symbol channel relays subsequent Redis publishes verbatim
- **Category**: Functional
- **Priority**: P0
- **Steps**: Connect via WS; send `{action:"subscribe", mode:"live", symbol:"RELIANCE"}`; have something publish a message to Redis channel `live:RELIANCE`
- **Expected Result**: The exact message payload is forwarded to the socket with zero parsing/transformation ("ZERO parsing overhead" — raw string passthrough via `ws.send(message)`).

#### TC-STC-002: Subscribing to backtest mode maps to the `backtest:` channel prefix
- **Category**: Functional
- **Priority**: P1
- **Steps**: Send `{action:"subscribe", mode:"backtest", symbol:"RELIANCE"}`
- **Expected Result**: Server subscribes to Redis channel `backtest:RELIANCE` (via `BACKTEST_PREFIX` env, default `backtest`) — distinct from the live channel for the same symbol.

#### TC-STC-003: `mode` value other than `"live"` defaults to backtest prefix
- **Category**: Negative / Regression
- **Priority**: P2
- **Steps**: Send `{action:"subscribe", mode:"paper", symbol:"RELIANCE"}` (an unrecognized mode string)
- **Expected Result**: Since the code only special-cases `mode === 'live'` and defaults `mode` variable to `BACKTEST_PREFIX` otherwise, any non-"live" string (including typos like "Live" with different casing, or "paper") silently subscribes to the BACKTEST channel — flag as a potential client-bug trap (no validation/rejection of unrecognized mode values).

#### TC-STC-004: First subscriber to a channel triggers a real Redis SUBSCRIBE; subsequent subscribers to the same channel reuse it
- **Category**: Functional / Performance
- **Priority**: P1
- **Steps**: Connect two separate WS clients, both subscribing to `live:RELIANCE`
- **Expected Result**: `ensureChannel` only calls `redisPubSub.subscribe(channel, ...)` once (guarded by `channelSubscriptions.has(channel)` check); the second client's subscription just adds to the existing `Set` of socket IDs — a single Redis message fans out to both sockets from one relay.

#### TC-STC-005: Unsubscribing when other sockets remain interested keeps the Redis subscription alive
- **Category**: Functional
- **Priority**: P1
- **Steps**: Two clients subscribed to `live:RELIANCE`; one sends `{action:"unsubscribe", mode:"live", symbol:"RELIANCE"}`
- **Expected Result**: That socket is removed from `channelSubscriptions`, but since the Set is non-empty (other client remains), `removeChannelIfUnused` does NOT unsubscribe from Redis; the remaining client continues receiving ticks.

#### TC-STC-006: Last unsubscriber from a channel triggers a real Redis UNSUBSCRIBE
- **Category**: Functional / Performance
- **Priority**: P1
- **Steps**: Single client subscribed to `live:RELIANCE` unsubscribes
- **Expected Result**: `channelSubscriptions.get(channel).size === 0` → channel entry deleted and `redisPubSub.unsubscribe(channel)` called — no wasted Redis subscription for a channel nobody is listening to.

#### TC-STC-007: Socket disconnect cleans up all of its channel subscriptions automatically
- **Category**: Functional
- **Priority**: P0
- **Steps**: Subscribe a socket to 3 different symbol/mode channels; forcibly close the WS connection (client-side close, not graceful unsubscribe)
- **Expected Result**: The `ws.on("close")` handler iterates `socketSubscriptions.get(socketId)`, removes the socket from each `channelSubscriptions` entry, and calls `removeChannelIfUnused` for each — no orphaned entries in `sockets`/`socketSubscriptions`/`channelSubscriptions` maps after disconnect (memory-leak regression guard).

### Malformed / Invalid Messages

#### TC-STC-008: Message missing `action`, `mode`, or `symbol` is rejected with a warning, connection stays open
- **Category**: Negative
- **Priority**: P1
- **Steps**: Send `{action:"subscribe"}` (missing `mode`/`symbol`), then `{}`, then a message with only `mode`
- **Expected Result**: `if (!msg.action || !msg.mode || !msg.symbol)` guard logs a warning and returns without crashing the connection or the server.

#### TC-STC-009: Non-JSON WebSocket message is caught and logged, connection stays open
- **Category**: Negative
- **Priority**: P1
- **Steps**: Send a raw non-JSON string over the WS connection
- **Expected Result**: `JSON.parse` throws inside the `try/catch` in the `message` handler; error logged (`Error processing message`); socket remains connected for subsequent valid messages.

#### TC-STC-010: Unsubscribe for a channel the socket never subscribed to is a safe no-op
- **Category**: Negative
- **Priority**: P2
- **Steps**: Send `{action:"unsubscribe", mode:"live", symbol:"NEVERSUBSCRIBED"}` without a prior subscribe
- **Expected Result**: `channelSubscriptions.get(channel)?.delete(socketId)` (optional chaining) safely no-ops since the channel doesn't exist in the map; no error thrown.

#### TC-STC-011: Unrecognized `action` value (not "subscribe"/"unsubscribe") is silently ignored
- **Category**: Negative
- **Priority**: P2
- **Steps**: Send `{action:"ping", mode:"live", symbol:"RELIANCE"}`
- **Expected Result**: Neither `if` branch matches; no state change, no error, no response sent back to the client (no ack/nack protocol exists at all — client has no way to confirm a subscribe succeeded beyond waiting for the first tick).

### Scaling / Multi-Instance Considerations

#### TC-STC-012: Service runs as a single replica — horizontal scaling would fragment socket state
- **Category**: Regression
- **Priority**: P1
- **Steps**: Inspect compose: `stream-to-client` has `deploy.replicas: 1`
- **Expected Result**: Confirmed single-replica design — the in-memory `sockets`/`channelSubscriptions` maps are process-local ("Local memory (SAFE for scaling)" comment in code is aspirational for the Redis-subscription part, but actual client-socket routing does NOT survive scaling to >1 replica without a shared coordination layer, since a client connected to replica A won't receive messages relayed only within replica B's memory). Document this as a genuine scaling ceiling if the comment's "SAFE for scaling" claim is ever acted upon by increasing `replicas`.

### Security / Access Control

#### TC-STC-013: No authentication on WebSocket connect or subscribe — any client can subscribe to any symbol
- **Category**: Security
- **Priority**: P1
- **Steps**: Connect anonymously and subscribe to an arbitrary symbol's live/backtest channel with no credentials
- **Expected Result**: Succeeds unconditionally — confirms zero authorization on market-data streaming (lower severity than trading endpoints since this is read-only tick data, but still an unauthenticated data-exposure surface, especially for backtest channels which could reveal another user's active backtest symbol/activity pattern).

#### TC-STC-014: Backtest channel naming leaks no deployment-specific info by symbol alone
- **Category**: Security
- **Priority**: P2
- **Steps**: Subscribe to `backtest:<symbol>` for a symbol currently being backtested by another user
- **Expected Result**: Since channels are keyed purely by symbol (not deployment_id), any client subscribing to the same symbol during another user's concurrent backtest would receive that user's backtest ticks too — verify this cross-tenant leak explicitly if multiple users can backtest the same symbol simultaneously.

### Reverse-Proxy Integration (cross-reference)

#### TC-STC-015: `/clientstreamer` reachable via nginx HTTP (port 80) but missing from HTTPS (443)
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #60
- **Steps**: See `infrastructure-nginx-reverse-proxy.md` TC-NGX-002/TC-NGX-005 for full detail
- **Expected Result**: Full detail tracked in the nginx test plan; noted here as the primary consumer-facing symptom (real-time price ticks fail on HTTPS-served frontends).
