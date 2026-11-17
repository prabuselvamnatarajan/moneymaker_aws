# Codebase Exploration, Technical Debt Cleanup & Production Readiness Plan

## Objective
Execute an exhaustive end-to-end review and refactoring of the MoneyMaker codebase prior to production launch. Adhering strictly to the **Zero Active Customers Policy**, eliminate all legacy backward-compatibility shims, obsolete database schemas, duplicate/shadow fields, unneeded routes, and dead code pathways. Ensure the code is strictly modular, follows DRY principles, and maintains 100% test coverage with zero logical gaps or security vulnerabilities.

---

## Phase Breakdown & Subtasks

### Phase 1: BackTestApp API & Database Architecture
- [ ] **Subtask 1.1: Standardize `Deployment` Schema on `timeframes: [String]`**
  - Make `timeframes: [String]` the sole interval specification for candle generation.
  - Drop singular `timeframe` property from schema, services, controller inputs, and default values.
  - Prune fallback resolution logic (`dep.timeframes?.[0] || dep.timeframe || '1m'`) in:
    - `BackTest/BackTestApp/src/models/deployment.js`
    - `BackTest/BackTestApp/src/services/deployment.js`
    - `BackTest/BackTestApp/src/controllers/deployment.js`
    - `kafka/services/StrategyChooserConsumer/topicRoutingHelper.js`
    - `shared/strategy/Strategy.js`
  - Update unit and integration tests.
- [ ] **Subtask 1.2: Consolidate Route Prefixing in `BackTestApp`**
  - Prune duplicate root-level router mounts (`app.use('/auth', ...)`, `app.use('/users', ...)`, etc.) in `BackTest/BackTestApp/src/app.js`.
  - Enforce canonical `/api/*` prefix across all endpoints, OpenAPI documentation, and reverse-proxy/frontend routing.
- [ ] **Subtask 1.3: Audit MongoDB Models for Redundant/Shadow Properties**
  - Review all models in `BackTest/BackTestApp/src/models/` and `src/iam/models/`.
  - Ensure consistent schema conventions (`created_at` vs `created_on`, audit timestamps).

### Phase 2: Kafka Consumers & Stream Processing Pipeline
- [ ] **Subtask 2.1: Centralized Timeframe Snapshot Consumption**
  - Verify all strategy consumers (`MSB`, `msb_pts`, `liquidity_sweep`) natively consume normalized snapshots from `timeframe-constructor`.
  - Ensure in-strategy candle builders and raw tick sniffers remain decommissioned.
- [ ] **Subtask 2.2: Stream Processing Code Duplication & Shared Libraries**
  - Audit `shared/strategy/Strategy.js`, `shared/redis_utils/`, and `shared/utils/`.
  - Extract duplicate logic across microservices into pure shared helper functions.
- [ ] **Subtask 2.3: Topic Naming Alignment (`splited-live-data` -> `live_data`)**
  - Evaluate and execute transition plan from legacy topic naming `splited-live-data` to `live_data`.

### Phase 3: MicroServices & Order Execution Layer
- [ ] **Subtask 3.1: PlaceOrders & Upstox Gateway Security & Modularity**
  - Verify authenticated trade ingestion paths (`POST /api/trades` with service-token).
  - Clean up dead endpoints, unused mock routes, and legacy payload converters.
- [ ] **Subtask 3.2: Option Chain & Market Quote Services**
  - Verify error handling and fail-loud triggers.
  - Remove unused fallback configurations or unauthenticated bridges.

### Phase 4: Frontend (`BackTestUI` & `client`) Modularity & Dead Code
- [ ] **Subtask 4.1: API Client Normalization**
  - Verify all API calls route to canonical `/api/*` endpoints.
  - Ensure detail and list views strictly self-fetch data via server-side scoped queries (no client-side filtering).
- [ ] **Subtask 4.2: Component & Type Definitions Cleanup**
  - Remove deprecated interfaces, unused components, and commented-out legacy JSX.

### Phase 5: End-to-End Verification, Security & Regression Suite
- [ ] **Subtask 5.1: Unit & Integration Test Suite Execution**
  - Execute unit tests across all Docker containers and local services.
- [ ] **Subtask 5.2: Security & Static Analysis**
  - Verify authentication, RBAC boundaries, token lifecycle, and fail-loud assertions.
- [ ] **Subtask 5.3: Documentation & Backlog Maintenance**
  - Update `FUTURE_WORKITEMS.md`, `GEMINI.md`, and `.agents/AGENTS.md`.
