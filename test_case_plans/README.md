# MoneyMaker — Master Test Case Plan Index

This directory contains the complete test case plan for the MoneyMaker trading platform: **678+ test cases** across **26 test plan files**, covering every service in `docker-compose.yml`, all 61 numbered findings in [`../issues.md`](../issues.md), and every major user-facing and internal data flow in the system.

Each linked file follows a consistent format: **Scope → Prerequisites → Test Cases** (grouped by feature area, each with Category/Priority/Related Issue/Preconditions/Steps/Expected Result/Notes). No test code is included — these are planning documents for manual or automated test authoring.

## How to Use This Index

1. Start with the **Priority Tiers** section below to decide what to test first given limited time/resources.
2. Use the **Coverage Map** to see which test files exercise which `docker-compose.yml` services.
3. Use the **Issues Cross-Reference** to jump straight to the regression tests for a specific `issues.md` finding.
4. Use the **Suggested Test Types** section to decide HOW to test each area (unit/integration/e2e/security/load).

---

## 1. Priority Tiers

### P0 — Critical: Test First (Security, Data Integrity, Money-Handling, Crash Risks)

These cover unauthenticated financial endpoints, cross-user data/token leakage, race conditions on money movement, and crashes that take down live trading.

| Area | File | Key P0 Concerns |
|---|---|---|
| Accounts & Ledger | [`BackTestApp-accounts-ledger.md`](./BackTestApp-accounts-ledger.md) | Lost-update race on deposit/withdraw/transfer (#35), negative balance on creation (#45), self-transfer guard (#47) |
| Strategies & Deployments | [`BackTestApp-strategies-deployments.md`](./BackTestApp-strategies-deployments.md) | IDOR on strategy/account ownership (#42), risky LIVE+active defaults (#33) |
| IAM / Auth | [`BackTestApp-iam-auth.md`](./BackTestApp-iam-auth.md) | Hardcoded JWT secrets (#36), no rate limiting (#37), RBAC never enforced (#41), wide-open CORS (#50) |
| placeorder gateway | [`microservice-placeorder.md`](./microservice-placeorder.md) | Zero auth + client controls LIVE/broker routing (#18, #14), unawaited Kafka crash (#59), wrong fill price recorded (#19) |
| Upstox OAuth/tokens | [`microservice-upstox-auth.md`](./microservice-upstox-auth.md) | OAuth `state` account hijack (#15), multi-tenant token isolation broken (#10), shared SDK singleton leak (#16) |
| ConnectWS-Upstox | [`microservice-connectws-upstox.md`](./microservice-connectws-upstox.md) | Unhandled rejection crashes live feed (#21), Kafka producer leak (#20) |
| Order Book / Funds / Options | [`microservice-orders-options.md`](./microservice-orders-options.md) | Cross-user account data leak via shared SDK singleton (#16), no auth (#14) |
| BacktestStreamer/Client | [`backtest-streamer-client.md`](./backtest-streamer-client.md) | Path traversal / arbitrary file read (#27), unauthenticated Kafka spoofing (#28) |
| MSB / msb_pts / liquidity_sweep | [`strategy-msb-live-backtest.md`](./strategy-msb-live-backtest.md), [`strategy-msb-pts-live-backtest.md`](./strategy-msb-pts-live-backtest.md), [`strategy-liquidity-sweep-live-backtest.md`](./strategy-liquidity-sweep-live-backtest.md) | MSB `[]` vs `null` crash (#62), msb_pts never opens SHORT (#64), liquidity_sweep concurrency counter cross-contamination (#65) |
| wsDataSplitter / StrategyChooser consumers | [`kafka-wsdatasplitter-consumer.md`](./kafka-wsdatasplitter-consumer.md), [`kafka-strategy-chooser-consumer.md`](./kafka-strategy-chooser-consumer.md) | Duplicate tick on retry (#63), missing produce retry (#69) |
| Docker/Kafka/Network Infra | [`infrastructure-docker-compose.md`](./infrastructure-docker-compose.md) | Kafka startup race (#5), flat network / no isolation (#52), RF=1 topics (#54), mongo-express/redisinsight weak auth (#56) |
| Nginx Reverse Proxy | [`infrastructure-nginx-reverse-proxy.md`](./infrastructure-nginx-reverse-proxy.md) | Missing `/clientstreamer` HTTPS block (#60), no auth gateway for financial routes (#14) |
| Secrets Hygiene | [`appinit-scheduled-services.md`](./appinit-scheduled-services.md) | Secrets committed to git incl. mongo keyfile (#58) |
| Frontend deployment defaults | [`BackTestUI.md`](./BackTestUI.md) | Deploy dialog defaults to LIVE+active (#33), token refresh/session security |
| Backtest data pipeline | [`backtest-data-export.md`](./backtest-data-export.md) | Disconnected volumes make exports unusable (#53) |

### P1 — High: Test Second (Correctness, Availability, Moderate Security)

Functional correctness of core trading/backtest flows, availability risks that don't directly expose money/data, and medium-severity security gaps.

- Trades/positions O(N) reporting perf (#9) — [`BackTestApp-trades-positions.md`](./BackTestApp-trades-positions.md)
- MFA disable without re-verification (#38), PATs/broker creds plaintext (#39, #29) — [`BackTestApp-iam-auth.md`](./BackTestApp-iam-auth.md), [`BackTestApp-brokers-users-admin.md`](./BackTestApp-brokers-users-admin.md)
- `is_internal` broker hijack (#40), admin bypasses (#51) — [`BackTestApp-brokers-users-admin.md`](./BackTestApp-brokers-users-admin.md)
- Password reset non-functional in prod (#44), self-delete no cascade (#46) — [`BackTestApp-iam-auth.md`](./BackTestApp-iam-auth.md)
- Deployment-symbol-resolver refresh race (#67), order-storer per-instrument collection fragmentation (#68) — [`kafka-deployment-symbol-resolver.md`](./kafka-deployment-symbol-resolver.md), [`kafka-storer-consumers.md`](./kafka-storer-consumers.md)
- Position tracker Redis caching/throttle correctness — [`kafka-position-tracker-consumer.md`](./kafka-position-tracker-consumer.md)
- Client-controlled market-data unauthenticated access (#14), URL injection (#22) — [`microservice-market-data.md`](./microservice-market-data.md), [`microservice-placeorder.md`](./microservice-placeorder.md)
- UpstoxLogin exposed on host port 8080 (#25), ConnectWS ignores requested user (#26) — [`microservice-upstox-auth.md`](./microservice-upstox-auth.md), [`microservice-connectws-upstox.md`](./microservice-connectws-upstox.md)
- Kafka partition key unused (#34), backtest data-export field/volume consistency (#32, #53) — [`backtest-streamer-client.md`](./backtest-streamer-client.md), [`backtest-data-export.md`](./backtest-data-export.md)
- Mongo replica set placement (#57), redis.conf empty bind-mount (#55) — [`infrastructure-mongo-redis.md`](./infrastructure-mongo-redis.md)
- MSBStrategyInit orphaned dead code (#30), appInit broken list seeding (#31) — [`appinit-scheduled-services.md`](./appinit-scheduled-services.md)

### P2 — Medium/Low: Test Third (Edge Cases, Hygiene, Low-Impact/Latent Bugs)

- ReDoS via unescaped regex search (#43) — [`BackTestApp-accounts-ledger.md`](./BackTestApp-accounts-ledger.md), [`BackTestApp-strategies-deployments.md`](./BackTestApp-strategies-deployments.md)
- Redis key non-namespaced fallback (#48), service-token trusts body user_id (#49) — [`strategy-msb-live-backtest.md`](./strategy-msb-live-backtest.md), [`BackTestApp-trades-positions.md`](./BackTestApp-trades-positions.md)
- `short_quantity` divergent Redis representations (#66) — [`strategy-liquidity-sweep-live-backtest.md`](./strategy-liquidity-sweep-live-backtest.md)
- Default Express error handler stack-trace leak (#24), no security headers (#23) — [`BackTestApp-iam-auth.md`](./BackTestApp-iam-auth.md), [`infrastructure-nginx-reverse-proxy.md`](./infrastructure-nginx-reverse-proxy.md)
- Docs diverge from implementation (#61) — [`infrastructure-docker-compose.md`](./infrastructure-docker-compose.md)
- UI annotation persistence gaps, hardcoded dev seed credentials on login screen — [`BackTestUI.md`](./BackTestUI.md)

---

## 2. Coverage Map — `docker-compose.yml` Services → Test Plans

| Compose Service | Test Plan(s) |
|---|---|
| `backtestapp` | `BackTestApp-accounts-ledger.md`, `BackTestApp-strategies-deployments.md`, `BackTestApp-trades-positions.md`, `BackTestApp-iam-auth.md`, `BackTestApp-brokers-users-admin.md` |
| `backtestui` (frontend) | `BackTestUI.md` |
| `wsdatasplitter-consumer` | `kafka-wsdatasplitter-consumer.md` |
| `strategychooser-consumer` | `kafka-strategy-chooser-consumer.md` |
| `price-storer-consumer`, `order-storer-consumer` | `kafka-storer-consumers.md` |
| `position-tracker-consumer` | `kafka-position-tracker-consumer.md` |
| `deployment-symbol-resolver-consumer` | `kafka-deployment-symbol-resolver.md` |
| `streamtoclient` (WS fan-out) | `kafka-stream-to-client.md` |
| `msb-strategy`, `msb-strategy-backtest` | `strategy-msb-live-backtest.md` |
| `msb-pts-strategy`, `msb-pts-strategy-backtest` | `strategy-msb-pts-live-backtest.md` |
| `liquidity-sweep-strategy`, `liquidity-sweep-strategy-backtest` | `strategy-liquidity-sweep-live-backtest.md` |
| `backteststreamer`, `backtestclient` | `backtest-streamer-client.md` |
| `exporttofile` | `backtest-data-export.md` |
| `placeorder` | `microservice-placeorder.md` |
| `upstock-login`, shared `AuthoriseUpstoxClient.js` | `microservice-upstox-auth.md` |
| `getltp`, `getohlc`, `fullmarketquote` | `microservice-market-data.md` |
| `getorderbook`, `fundsandmargin`, `optioncontracts`, `putcalloptionchain` | `microservice-orders-options.md` |
| `connectws-upstox` | `microservice-connectws-upstox.md` |
| `kafka1/2/3`, `mongo1/2/3`, `redis`, `app-net`, volumes | `infrastructure-docker-compose.md` |
| `nginx` (reverse proxy) | `infrastructure-nginx-reverse-proxy.md` |
| `mongo-express`, `redisinsight`, replica set | `infrastructure-mongo-redis.md` |
| `appinit`, `MSBStrategyInit` (orphaned), git secrets hygiene | `appinit-scheduled-services.md` |

---

## 3. Issues.md Cross-Reference (All 61 Findings)

Every numbered finding in `issues.md` has at least one corresponding regression test case below. Numbers not listed (1, 2, 4, 6, 7, 8, 11, 12) were already resolved prior to this audit and have no open finding.

| # | Title | Severity | Primary Test Plan |
|---|---|---|---|
| 3 | Incomplete input validation in `placeorder` | Medium | `microservice-placeorder.md` |
| 5 | Kafka startup race condition | Medium | `infrastructure-docker-compose.md` |
| 9 | O(N) trade history replay | Medium | `BackTestApp-trades-positions.md` |
| 10 | Multi-tenant Upstox token isolation broken | Critical | `microservice-upstox-auth.md` |
| 13 | Docker image run failure — volume dependency | Critical | `infrastructure-docker-compose.md` |
| 14 | All trading/market-data endpoints unauthenticated | Critical | `microservice-placeorder.md`, `microservice-market-data.md`, `microservice-orders-options.md` |
| 15 | OAuth `state` used as unverified user ID | Critical | `microservice-upstox-auth.md` |
| 16 | Shared global Upstox SDK client cross-user leak | Critical | `microservice-upstox-auth.md`, `microservice-market-data.md`, `microservice-orders-options.md` |
| 17 | TLS cert validation disabled globally for `placeorder` | Critical | `infrastructure-docker-compose.md` |
| 18 | Client controls LIVE vs paper/broker routing | Critical | `microservice-placeorder.md` |
| 19 | Live-order ledger records client price not fill price | High | `microservice-placeorder.md` |
| 20 | Kafka producer leak on WS reconnect | Medium | `microservice-connectws-upstox.md` |
| 21 | Unhandled rejection on malformed WS/protobuf frames | High | `microservice-connectws-upstox.md` |
| 22 | Unsanitized URL interpolation in outbound calls | Medium | `microservice-placeorder.md` |
| 23 | No security headers/rate limiting/CORS on financial endpoints | Medium | `BackTestApp-iam-auth.md`, `infrastructure-nginx-reverse-proxy.md` |
| 24 | Default Express error handler leaks stack traces | Low | `BackTestApp-iam-auth.md` |
| 25 | UpstoxLogin exposed on host port 8080 | Medium | `microservice-upstox-auth.md` |
| 26 | ConnectWS-Upstox ignores requested user | Low | `microservice-connectws-upstox.md` |
| 27 | Path traversal / arbitrary file read in BacktestStreamer | Critical | `backtest-streamer-client.md` |
| 28 | Unauthenticated endpoint allows Kafka tick/deployment spoofing | High | `backtest-streamer-client.md` |
| 29 | Broker API secrets returned to frontend in plaintext | High | `BackTestApp-brokers-users-admin.md` |
| 30 | `MSBStrategyInit` orphaned dead code | Medium | `appinit-scheduled-services.md` |
| 31 | `appInit` seeds broken Redis list keys | Low | `appinit-scheduled-services.md` |
| 32 | Hardcoded external Mongo URI baked into image | Medium | `backtest-data-export.md` |
| 33 | Deploy Strategy form defaults to LIVE + active | Medium | `BackTestApp-strategies-deployments.md`, `BackTestUI.md` |
| 34 | Unused Kafka partition key logic | Low | `backtest-streamer-client.md` |
| 35 | Lost-update race in deposit/withdraw/transfer | Critical | `BackTestApp-accounts-ledger.md` |
| 36 | Hardcoded fallback JWT secrets | Critical | `BackTestApp-iam-auth.md` |
| 37 | No rate limiting on auth/MFA endpoints | Critical | `BackTestApp-iam-auth.md` |
| 38 | MFA can be disabled without re-verification | High | `BackTestApp-iam-auth.md` |
| 39 | PATs and broker credentials stored in plaintext | High | `BackTestApp-iam-auth.md`, `BackTestApp-brokers-users-admin.md` |
| 40 | `createBroker` allows client-set `is_internal:true` | High | `BackTestApp-brokers-users-admin.md` |
| 41 | RBAC `authorize()` middleware never used | High | `BackTestApp-iam-auth.md` |
| 42 | IDOR: `createDeployment` doesn't validate ownership | High | `BackTestApp-strategies-deployments.md` |
| 43 | ReDoS via unescaped regex in search | Medium | `BackTestApp-accounts-ledger.md`, `BackTestApp-strategies-deployments.md` |
| 44 | Password reset non-functional in production | Medium | `BackTestApp-iam-auth.md` |
| 45 | No balance validation on account creation | Medium | `BackTestApp-accounts-ledger.md` |
| 46 | Self-service user deletion — no re-auth/cascade | Medium | `BackTestApp-iam-auth.md` |
| 47 | Weak self-transfer guard | Medium | `BackTestApp-accounts-ledger.md` |
| 48 | Redis key non-namespaced fallback in strategy code | Low | `strategy-msb-live-backtest.md`, `strategy-msb-pts-live-backtest.md` |
| 49 | Service-token trade endpoint trusts body `user_id` | Low | `BackTestApp-trades-positions.md` |
| 50 | Wide-open CORS on BackTestApp | Low | `BackTestApp-iam-auth.md` |
| 51 | Admin create account/strategy bypasses validation | Low | `BackTestApp-brokers-users-admin.md` |
| 52 | No network isolation — single flat `app-net` | Critical | `infrastructure-docker-compose.md` |
| 53 | Backtest data pipeline volumes disconnected | Critical | `backtest-data-export.md`, `backtest-streamer-client.md` |
| 54 | Kafka topics RF=1, single partition | High | `infrastructure-docker-compose.md` |
| 55 | `redis.conf` bind-mount source is empty directory | Medium | `infrastructure-mongo-redis.md` |
| 56 | `mongo-express`/`redisinsight` weak/no auth | Critical | `infrastructure-mongo-redis.md` |
| 57 | MongoDB replica set lacks Swarm placement constraints | High | `infrastructure-mongo-redis.md` |
| 58 | Secrets committed to git | Critical | `appinit-scheduled-services.md` |
| 59 | Unawaited Kafka publish crashes `placeorder` | High | `microservice-placeorder.md` |
| 60 | Reverse-proxy `/clientstreamer` missing from HTTPS block | High | `infrastructure-nginx-reverse-proxy.md`, `kafka-stream-to-client.md` |
| 61 | System flow docs diverge from implementation | Low | `infrastructure-docker-compose.md` |
| 62 | MSB crashes on transient Redis read error (`[]` vs `null`) | Critical | `strategy-msb-live-backtest.md` |
| 63 | `wsDataSplitterConsumer` can duplicate messages on retry | Critical | `kafka-wsdatasplitter-consumer.md` |
| 64 | `msb_pts` never opens SHORT positions | High | `strategy-msb-pts-live-backtest.md` |
| 65 | `liquidity_sweep` concurrency counter not scoped by deployment | High | `strategy-liquidity-sweep-live-backtest.md` |
| 66 | Divergent Redis representations for `short_quantity` | Medium | `strategy-liquidity-sweep-live-backtest.md` |
| 67 | `deploymentSymbolResolverConsumer` refresh race | Medium | `kafka-deployment-symbol-resolver.md` |
| 68 | `order-storer-consumer` fragments per-instrument collections | Medium | `kafka-storer-consumers.md` |
| 69 | `StrategyChooserConsumer` Kafka produce has no retry | Low | `kafka-strategy-chooser-consumer.md` |

---

## 4. Suggested Test Types by Area

| Test Type | Best Fit Areas | Notes |
|---|---|---|
| **Unit** | Strategy signal logic (MSB/msb_pts/liquidity_sweep math), order-sizing formulas, ledger balance math, JWT/token expiry parsing, `getRelatedStrikePrices`, sanitization functions | Pure functions with deterministic inputs — cheapest to automate, run on every commit |
| **Integration** | BackTestApp service layer + MongoDB (transactions, cascade deletes), Kafka consumer ↔ producer chains, Redis state read/write per strategy, appInit seeding | Requires real (or `mongodb-memory-server`/`testcontainers`) Mongo/Redis/Kafka instances |
| **End-to-End (E2E)** | Full deployment lifecycle (create → start → trade → metrics → delete), OAuth flow, login/MFA/session, backtest replay pipeline (Streamer→Client→Kafka→Strategy) | Exercise the real docker-compose stack; highest confidence, slowest to run |
| **Security** | All P0 items above — unauthenticated endpoints (#14, #28), token isolation (#10, #16), IDOR (#42), path traversal (#27), secrets in git/images (#58, #32, #39, #29), RBAC (#41), CORS (#50) | Should include automated scanning (e.g., ZAP) plus the manual PoC steps documented in each file |
| **Performance/Load** | O(N) reporting (#9), Kafka producer leak (#20), unbounded queues in `BacktestClient`, RF=1 Kafka topics under load (#54), concurrent multi-user Upstox singleton races (#16) | Use k6/Artillery for HTTP; custom scripts for WS/Kafka concurrency races |
| **Chaos/Resilience** | Kafka broker outage mid-request, Mongo/Redis unavailability, WS disconnect/reconnect, malformed protobuf frames (#21), transient Redis errors (#62) | Inject failures via `toxiproxy`/manual container stop-start; verify no unhandled crashes |
| **Regression (issues.md-driven)** | Every test case tagged `Related Issue` across all 26 files | Run before/after any fix to confirm the specific bug is resolved without reintroducing it |

---

## 5. File Index (All 26 Test Plans)

### BackTestApp & UI
1. [`BackTestApp-accounts-ledger.md`](./BackTestApp-accounts-ledger.md) — 53 cases
2. [`BackTestApp-strategies-deployments.md`](./BackTestApp-strategies-deployments.md) — 62 cases
3. [`BackTestApp-trades-positions.md`](./BackTestApp-trades-positions.md) — 41 cases
4. [`BackTestApp-iam-auth.md`](./BackTestApp-iam-auth.md) — 64 cases
5. [`BackTestApp-brokers-users-admin.md`](./BackTestApp-brokers-users-admin.md) — 32 cases
6. [`BackTestUI.md`](./BackTestUI.md) — 48 cases

### Kafka Consumers & Pipeline
7. [`kafka-wsdatasplitter-consumer.md`](./kafka-wsdatasplitter-consumer.md) — 14 cases
8. [`kafka-strategy-chooser-consumer.md`](./kafka-strategy-chooser-consumer.md) — 14 cases
9. [`kafka-storer-consumers.md`](./kafka-storer-consumers.md) — 13 cases
10. [`kafka-position-tracker-consumer.md`](./kafka-position-tracker-consumer.md) — 16 cases
11. [`kafka-deployment-symbol-resolver.md`](./kafka-deployment-symbol-resolver.md) — 16 cases
12. [`kafka-stream-to-client.md`](./kafka-stream-to-client.md) — 15 cases

### Strategies
13. [`strategy-msb-live-backtest.md`](./strategy-msb-live-backtest.md) — 23 cases
14. [`strategy-msb-pts-live-backtest.md`](./strategy-msb-pts-live-backtest.md) — 19 cases
15. [`strategy-liquidity-sweep-live-backtest.md`](./strategy-liquidity-sweep-live-backtest.md) — 23 cases

### Backtest Pipeline
16. [`backtest-streamer-client.md`](./backtest-streamer-client.md) — 25 cases
17. [`backtest-data-export.md`](./backtest-data-export.md) — 23 cases

### MicroServices
18. [`microservice-placeorder.md`](./microservice-placeorder.md) — 24 cases
19. [`microservice-upstox-auth.md`](./microservice-upstox-auth.md) — 21 cases
20. [`microservice-market-data.md`](./microservice-market-data.md) — 15 cases
21. [`microservice-orders-options.md`](./microservice-orders-options.md) — 16 cases
22. [`microservice-connectws-upstox.md`](./microservice-connectws-upstox.md) — 22 cases

### Infrastructure & Init
23. [`infrastructure-docker-compose.md`](./infrastructure-docker-compose.md) — 23 cases
24. [`infrastructure-nginx-reverse-proxy.md`](./infrastructure-nginx-reverse-proxy.md) — 18 cases
25. [`infrastructure-mongo-redis.md`](./infrastructure-mongo-redis.md) — 18 cases
26. [`appinit-scheduled-services.md`](./appinit-scheduled-services.md) — 20 cases

---

## 6. Notes on Methodology

- Every test plan was derived from direct source-code reading (not assumptions) — route files, service layers, models, Kafka consumers, strategy state machines, and Dockerfiles/compose configuration were read in full for the components they cover.
- Every finding in `issues.md` is treated as a **regression test target**: the corresponding test case documents both the reproduction steps AND the expected (buggy) current behavior, so these tests can validate a fix (test should FLIP from demonstrating the bug to confirming it's resolved).
- Test cases are intentionally exhaustive rather than minimal — this plan is meant to be triaged (via the Priority Tiers above) rather than executed wall-to-wall for every release.
- No test automation code is included by design; this is a planning artifact for QA/dev teams to implement against their chosen test framework (Jest/Mocha for unit/integration, Playwright/Cypress for E2E UI, k6/Artillery for load, ZAP/Burp for security scanning).
