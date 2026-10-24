# Failed & Skipped Test Cases Report

**Date & Time:** 2026-10-24 16:35 IST  
**Environment:** Linux / Local Minikube (`https://algo.mrcobra.link/backtestapp`)  
**Node.js Runtime:** v20.20.1

---

## Summary of Test Execution

| Suite | Category | Total | Passed | Skipped | Failed |
|---|---|---|---|---|---|
| `BackTest/BackTestApp` | Unit / Controller / Route / Service | 45 | 45 | 0 | 0 |
| `BackTestApp` (Parallel Isolation) | Isolation / Multi-Timeframe / Determinism | 57 | 57 | 0 | 0 |
| `MicroServices/Orders/placeOrders` | Balance Resolution | 4 | 4 | 0 | 0 |
| `MicroServices/Shared/AuthorisedUpstox` | Auth Token Flow | 1 | 1 | 0 | 0 |
| `kafka/services/Strategies/MSB` | Strategy & Candle Aggregation | 31 | 31 | 0 | 0 |
| `kafka/services/Strategies/liquidity_sweep` | Liquidity Sweep Strategy | 28 | 28 | 0 | 0 |
| `kafka/services/Strategies/msb_pts` | MSB PTS Strategy & Risk Rules | 20 | 20 | 0 | 0 |
| `kafka/services/positionTrackerConsumer` | Real-time Position Tracking | 19 | 19 | 0 | 0 |
| `kafka/services/StrategyChooserConsumer` | Strategy Routing & Tick Isolation | 6 | 6 | 0 | 0 |
| `e2e/backtest-app` (Playwright API) | E2E API & Integration | 253 | 230 | **15** | **8** |

---

## Detailed List of Failing Test Cases

### 1. `TC-BRK-012: Admin CAN update/delete internal broker`
- **File:** [brokers-users-admin.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/brokers-users-admin.spec.ts#L414)
- **Suite:** `[api] › backtest-app/brokers-users-admin.spec.ts:414:5`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  Error: Unexpected status: expected 200, got 500: {"message":"Internal broker Cobra Trades cannot be deleted."}
      at deleteBroker (file:///app/src/services/broker.js:292:11)
  ```
- **Root Cause:**
  The broker service enforces a business rule prohibiting deletion of the internal system broker (`Cobra Trades`), whereas the test case expects an admin to be able to delete it with a 200 OK.

---

### 2. `TC-BRK-014: Deleting broker referenced by account leaves dangling broker_id`
- **File:** [brokers-users-admin.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/brokers-users-admin.spec.ts#L468)
- **Suite:** `[api] › backtest-app/brokers-users-admin.spec.ts:468:5`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  Error: Unexpected status: expected 200, got 500: {"message":"Cannot delete broker with active LIVE account associations (1 live account(s) linked)."}
      at deleteBroker (file:///app/src/services/broker.js:300:13)
  ```
- **Root Cause:**
  The service layer prevents deleting a broker that has active linked accounts. The test expects the deletion to succeed (leaving a dangling reference).

---

### 3. `TC-AUTH-005: successful login without MFA returns access + refresh tokens`
- **File:** [iam-auth.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/iam-auth.spec.ts#L210)
- **Suite:** `[api] › backtest-app/iam-auth.spec.ts:210:7 › Login`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  Error: expect(received).toMatch(expected)
  Expected pattern: /^203\.0\.113\.50/
  Received string:  "10.244.0.1"
      at iam-auth.spec.ts:231:39
  ```
- **Root Cause:**
  The test asserts that the client IP stored in the session matches the forwarded mock client IP header (`203.0.113.50`). In the local Minikube / ingress-nginx network, `x-forwarded-for` / remote address evaluates to the internal gateway IP (`10.244.0.1`).

---

### 4. `TC-AUTH-012: session records device/OS/browser/IP from headers`
- **File:** [iam-auth.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/iam-auth.spec.ts#L338)
- **Suite:** `[api] › backtest-app/iam-auth.spec.ts:338:7 › Login`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  Error: expect(received).toBe(expected) // Object.is equality
  Expected: "198.51.100.42"
  Received: "10.244.0.1"
      at iam-auth.spec.ts:354:24
  ```
- **Root Cause:**
  Same IP forwarding header behavior: Minikube ingress-nginx controller overrides or passes upstream IP as `10.244.0.1` instead of trusting the custom client IP header.

---

### 5. `TC-DEP-040: /metrics O(N) replay performance on large trade history @slow`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L1422)
- **Suite:** `[api] › backtest-app/strategies-deployments.spec.ts:1422:7 › Deployment monitoring`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
  Call log:
    - → POST https://algo.mrcobra.link/backtestapp/trades
  ```
- **Root Cause:**
  Seeding bulk trade fixtures sequentially exceeded Playwright's default action timeout of 15,000ms under local container load.

---

### 6. `TC-DEP-043: /analysis computes drawdown/drawup and profitability factor correctly`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L1477)
- **Suite:** `[api] › backtest-app/strategies-deployments.spec.ts:1477:7 › Deployment monitoring`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
  Call log:
    - → POST https://algo.mrcobra.link/backtestapp/trades
  ```
- **Root Cause:**
  Timed out during trade fixture creation (15s request timeout exceeded).

---

### 7. `TC-DEP-044: /analysis and /metrics both O(N) — reporting endpoints replay all trades every call @slow`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L1523)
- **Suite:** `[api] › backtest-app/strategies-deployments.spec.ts:1523:7 › Deployment monitoring`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  Error: seedTrades failed at 27: 502 Bad Gateway
  ```
- **Root Cause:**
  The server or reverse-proxy returned a 502 Bad Gateway during heavy sequential trade insertion, hitting upstream response timeouts.

---

### 8. `TC-DEP-045: /candles proxies to symbol candle data using deployment backtest date`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L1549)
- **Suite:** `[api] › backtest-app/strategies-deployments.spec.ts:1549:7 › Deployment monitoring`
- **Status:** `FAILED`
- **Observed Behavior:**
  ```text
  TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
  Call log:
    - → POST https://algo.mrcobra.link/backtestapp/deployments
  ```
- **Root Cause:**
  Deployment setup timed out on `POST /deployments` due to backpressure / queuing from preceding heavy tests.

---

## Detailed List of Skipped Test Cases

The E2E suite skipped **15** test cases due to intentional environmental prerequisites (missing optional sub-stacks like option-chain/market-quote data, offline tick files, or dedicated no-secrets configurations):

### 1. `TC-ADM-015: authorize() middleware wired to zero routes — duplicate of TC-RBAC-001 (#41)`
- **File:** [brokers-users-admin.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/brokers-users-admin.spec.ts#L959)
- **Reason:** Intentionally skipped: exact duplicate audit of `TC-RBAC-001` in `iam-auth.spec.ts`.

### 2. `TC-AUTH-013: JWT secrets fall back to hardcoded defaults when env unset (#36)`
- **File:** [iam-auth.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/iam-auth.spec.ts#L364)
- **Reason:** Requires `API_NO_SECRETS_BASE_URL` (stack started intentionally without `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`).

### 3. `TC-AUTH-015: forged access token using default secret accepted by authenticate() (#36)`
- **File:** [iam-auth.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/iam-auth.spec.ts#L402)
- **Reason:** Requires `API_NO_SECRETS_BASE_URL` (requires a container instance configured without JWT secret environment variables).

### 4. `TC-RBAC-002: fine-grained Permissions on Role have no API effect`
- **File:** [iam-auth.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/iam-auth.spec.ts#L1165)
- **Reason:** Requires direct `MONGO_URI` connection to inject mock restrictive role directly into database.

### 5. `TC-DEP-011: Deploy dialog defaults to LIVE mode + active status (regression guard)`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L613)
- **Reason:** UI test only; validated in UI suite (`e2e/backtest-ui/deploy-dialog.spec.ts: TC-UI-024`).

### 6. `TC-DEP-017: Re-resolve deferred when an open position exists`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L803)
- **Reason:** Requires live option-chain microservices to dynamically resolve underlying strike tokens during deployment creation.

### 7. `TC-DEP-018: Resolve conflicts with another active deployment already on the target token`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L862)
- **Reason:** Requires live option-chain microservices to create initial underlying symbol control deployment.

### 8. `TC-DEP-019: Resolve is a no-op when target token and strike are unchanged`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L919)
- **Reason:** Requires live option-chain microservices.

### 9. `TC-DEP-021: Redis key migration on symbol remap renames deployment-scoped keys`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L968)
- **Reason:** Requires live option-chain microservices to create symbol control deployment.

### 10. `TC-DEP-031: start/restart/resume with symbol_control.enabled triggers a fresh resolve attempt`
- **File:** [strategies-deployments.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/strategies-deployments.spec.ts#L1228)
- **Reason:** Requires live option-chain microservices.

### 11. `TC-TRD-021: legacy cache without OPEN Position synthesizes on scale-in`
- **File:** [trades-positions.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/trades-positions.spec.ts#L800)
- **Reason:** Requires direct `MONGO_URI` / `mongosh` access from the runner to drop Position documents while leaving Deployment cache intact.

### 12. `TC-TRD-024: BACKTEST position tracks max_up/max_down from tick files`
- **File:** [trades-positions.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/trades-positions.spec.ts#L892)
- **Reason:** Requires local tick files present in `exportedData/<date>/<symbol>.json` volume for excursion replay.

### 13. `TC-TRD-025: excursion tick lookup tries fallback paths`
- **File:** [trades-positions.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/trades-positions.spec.ts#L942)
- **Reason:** Requires local tick files in `exportedData/<date>/<symbol>.json`.

### 14. `TC-TRD-027: multi-day BACKTEST aggregates ticks across date range`
- **File:** [trades-positions.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/trades-positions.spec.ts#L1012)
- **Reason:** Requires multi-day backtest tick data in `exportedData/`.

### 15. `TC-TRD-036: flush pending symbol resolve after full flat close`
- **File:** [trades-positions.spec.ts](file:///home/prabu/Desktop/Work%20Folder/MoneyMaker%20GitLab%20AWS/e2e/backtest-app/trades-positions.spec.ts#L1432)
- **Reason:** Requires option-chain and LTP services to configure dynamic underlying symbol control.
