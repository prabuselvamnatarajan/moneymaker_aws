# BackTestApp — Brokers, Users & Admin — Test Case Plan

## Scope
Covers `Broker` CRUD (`/api/brokers`, `/api/external-brokers`), the `is_internal` platform-shared broker mechanism, broker credential/secret handling, and the full admin surface (`/api/admin/*`) for user management and admin-side resource creation. Also covers cross-cutting authorization gaps between admin and user-facing paths.

## Prerequisites
- At least one admin-role user and one regular user
- At least one internal broker record ("Cobra Trades") and one external broker (e.g., Upstox) type available via `/api/external-brokers`
- Ability to inspect raw HTTP response bodies (to check for secret leakage)

## Test Cases

### Broker — Create

#### TC-BRK-001: Regular user can create their own (non-internal) broker
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/brokers` with `{name:"My Upstox", external_broker_id:"upstox", credentials:{...}}`
- **Expected Result**: Broker created with `user_id` set to caller, `is_internal` defaults to `false`.

#### TC-BRK-002: `createBroker` has no field whitelist — client can set `is_internal:true`
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #40
- **Steps**: As a non-admin user, `POST /api/brokers` with `{name:"Hijack", is_internal:true}`
- **Expected Result** (current bug): Broker is saved with `is_internal:true` since the service does `new Broker({...brokerData, user_id: userId})` with no field filtering — a single non-admin user can create a second/competing internal broker record.

#### TC-BRK-003: Multiple internal brokers can coexist — no uniqueness constraint
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #40
- **Steps**: Following TC-BRK-002, create a PAPER account for a *different* user via `POST /api/accounts`
- **Expected Result** (current bug): `createAccount`'s `Broker.findOne({is_internal:true})` has no tiebreaker/ordering — whichever internal broker document Mongo returns first (potentially the attacker's hijacked one) becomes the assigned broker for ALL future PAPER/SIMULATION accounts platform-wide, until the original is naturally returned again. No `unique` partial index exists on `{is_internal:true}` to prevent duplicates.

#### TC-BRK-004: Missing required `name` field rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `POST /api/brokers` with no `name`
- **Expected Result**: Mongoose required validation error.

### Broker — Secrets Handling

#### TC-BRK-005: `GET /api/brokers` returns raw `credentials`/`access_token` in plaintext
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #29
- **Steps**: Create a broker with `credentials:{client_secret:"supersecret123"}`; call `GET /api/brokers`; inspect raw JSON response
- **Expected Result** (current bug): Full `credentials` object and `access_token` are returned verbatim in the API response — no masking/redaction server-side. (Frontend's `isSecret` toggle in `BrokersListView.tsx` is purely a client-side display concern and does not protect the wire payload.)

#### TC-BRK-006: Non-admin list only sees internal brokers + their own
- **Category**: Security
- **Priority**: P1
- **Steps**: User A creates a personal broker; User B calls `GET /api/brokers`
- **Expected Result**: User B sees all `is_internal:true` brokers plus only their own `user_id`-scoped brokers — User A's personal broker is excluded. Confirm this scoping still exposes secrets for every internal broker to every user (cross-reference TC-BRK-005).

#### TC-BRK-007: Admin list (`isAdmin=true` path) returns ALL brokers platform-wide, including other users' personal brokers and secrets
- **Category**: Security
- **Priority**: P1
- **Steps**: Call the broker listing as an admin
- **Expected Result**: `Broker.find({})` returns every broker regardless of owner — combined with TC-BRK-005, an admin (or anything hitting this path without proper `isAdmin` gating) sees every user's plaintext broker secrets.

#### TC-BRK-008: Expired Upstox token is auto-cleared and reported as `token_status: "expired"`
- **Category**: Functional
- **Priority**: P1
- **Steps**: A non-internal Upstox broker has an `access_token` past expiry; call `GET /api/brokers`
- **Expected Result**: `sanitizeExpiredUpstoxBrokers` detects expiry, clears `access_token` on the broker doc, deletes the per-user and default Redis token keys, publishes a `broker_updated` event on the `broker_updates` Redis channel, and returns the broker with `access_token:""` and `token_status:"expired"` in the response.

#### TC-BRK-009: Non-expired Upstox broker gets a `token_status` field attached without mutation
- **Category**: Functional
- **Priority**: P2
- **Steps**: Valid, unexpired token; call `GET /api/brokers`
- **Expected Result**: `token_status` reflects the live status (e.g., "valid") computed via `getUpstoxTokenStatus`; no DB write occurs.

### Broker — Update / Delete

#### TC-BRK-010: Non-admin cannot update or delete an internal broker
- **Category**: Security
- **Priority**: P0
- **Steps**: `PUT /api/brokers/:internalBrokerId` and `DELETE /api/brokers/:internalBrokerId` as a non-admin
- **Expected Result**: Query includes `is_internal:false` guard — internal brokers are not matched; "Broker not found or you are not authorized to modify/delete it." error.

#### TC-BRK-011: Non-admin cannot update/delete another user's personal broker (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B attempts `PUT`/`DELETE` on User A's personal broker id
- **Expected Result**: Scoped query (`_id, user_id, is_internal:false`) finds nothing; rejected.

#### TC-BRK-012: Admin CAN update/delete internal broker
- **Category**: Functional
- **Priority**: P1
- **Steps**: Admin calls `PUT`/`DELETE` on the internal broker
- **Expected Result**: Allowed (`isAdmin` query bypasses the `is_internal:false` restriction).

#### TC-BRK-013: Update credentials merges rather than replaces
- **Category**: Functional
- **Priority**: P2
- **Steps**: Broker has `credentials:{a:1,b:2}`; `PUT` with `credentials:{b:3,c:4}`
- **Expected Result**: Resulting `credentials` is `{a:1,b:3,c:4}` (shallow merge via spread), not a full replace.

#### TC-BRK-014: Deleting a broker referenced by an existing Account leaves the Account with a dangling `broker_id`
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: Create an Account referencing a personal broker; delete that broker
- **Expected Result**: No cascade/reference-check exists on delete — verify the Account now references a nonexistent `broker_id`, and confirm what happens on next `populate("broker_id")` call (likely resolves to `null`), and whether trade creation against that account still functions.

### External Broker Catalog

#### TC-BRK-015: Any authenticated user can list the external broker catalog
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /api/external-brokers` as a regular user
- **Expected Result**: 200 with catalog entries (e.g., Upstox metadata); no admin restriction on read.

#### TC-BRK-016: Only admin can create/update/delete external broker catalog entries
- **Category**: Security
- **Priority**: P1
- **Steps**: Regular user attempts `POST`/`PUT`/`DELETE /api/external-brokers`
- **Expected Result**: Rejected by `isAdmin` middleware (403).

### Admin — User Management

#### TC-ADM-001: Non-admin cannot access any `/api/admin/*` route
- **Category**: Security
- **Priority**: P0
- **Steps**: Regular user calls `GET /api/admin/users`
- **Expected Result**: Blocked by `isAdmin` middleware (403) after passing `authenticate`.

#### TC-ADM-002: Admin creates a new user; duplicate email/username rejected
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/admin/users` with a unique email/username, then repeat with the same email
- **Expected Result**: First succeeds (password bcrypt-hashed, default "user" role assigned if none provided, predefined accounts auto-initialized via `initializeUserAccounts`); second call returns 409 "Email is already taken".

#### TC-ADM-003: Duplicate username (different email) rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: Reuse an existing `username` with a new `email`
- **Expected Result**: 409 "Username is already taken".

#### TC-ADM-004: Missing required fields on user creation rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `POST /api/admin/users` omitting `password` (or `email`/`username`/`name`)
- **Expected Result**: 400 "Username, name, email, and password are required".

#### TC-ADM-005: `initializeUserAccounts` failure during user creation does not block user creation
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate a failure in `accountInitializer.js` (e.g., DB error) during admin user creation
- **Expected Result**: Error is caught and logged; user creation still returns 201 — verify the new user simply lacks predefined accounts rather than the whole request failing.

#### TC-ADM-006: Admin update user — email/username uniqueness re-checked only when changed
- **Category**: Functional
- **Priority**: P2
- **Steps**: `PATCH /api/admin/users/:userId` with the same email as before (no-op) vs. changing to an email used by another user
- **Expected Result**: No-op case succeeds; conflicting change returns 409.

#### TC-ADM-007: Admin update user password re-hashes via bcrypt
- **Category**: Security
- **Priority**: P1
- **Steps**: `PATCH` with a new `password`
- **Expected Result**: Stored password is a bcrypt hash, not plaintext; response never includes the password field (`select("-password")`).

#### TC-ADM-008: Admin delete user is a hard delete with no cascade cleanup
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: `DELETE /api/admin/users/:userId` for a user with existing Accounts/Deployments/Trades/Sessions/PATs
- **Expected Result** (gap): Only the `User` document is deleted (`findByIdAndDelete`); all related Accounts, Deployments, Trades, Ledgers, Sessions, and PersonalAccessTokens remain orphaned in the database with no cleanup — same class of issue as the self-delete gap (#46), but on the admin path too.

#### TC-ADM-009: Get/list users returns `-password` and populates `roles`
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /api/admin/users` and `GET /api/admin/users/:userId`
- **Expected Result**: Password field absent from every returned user; `roles` populated with Role documents.

### Admin — User Sub-Resource Management (Bypasses Service Layer)

#### TC-ADM-010: `createUserAccount` bypasses `services/account.js#createAccount` — no internal-broker auto-assignment
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #51
- **Steps**: `POST /api/admin/users/:userId/accounts` with `{account_name:"Admin-created PAPER", account_type:"PAPER", initial_balance:10000}` and NO `broker_id`
- **Expected Result** (current bug): Because `admin.js` constructs `new Account({...req.body, user_id})` directly instead of calling the service function, the PAPER account is saved WITHOUT the internal-broker auto-assignment logic — `broker_id` remains unset, unlike the same account type created via the normal user-facing `/api/accounts` endpoint (TC-ACC-001). Verify whether the model's `pre("save")` hook still catches this (it only validates when `broker_id` IS set, so an unset `broker_id` slips through entirely) — the account ends up brokerless.

#### TC-ADM-011: `createUserAccount` skips `current_balance` defaulting logic from the service
- **Category**: Regression
- **Priority**: P2
- **Related Issue**: #51
- **Steps**: `POST /api/admin/users/:userId/accounts` omitting `current_balance` but supplying `initial_balance`
- **Expected Result**: Since the service-layer default (`current_balance = current_balance ?? initial_balance`) is bypassed, verify whether `current_balance` falls back to the schema default of `0` instead of `initial_balance` — producing an inconsistent starting balance vs. the user-facing creation path.

#### TC-ADM-012: `createUserStrategy` bypasses `services/strategy.js#createStrategy` — no advanced-field defaulting
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #51
- **Steps**: `POST /api/admin/users/:userId/strategies` with `{strategy_name:"Admin Strategy"}` and no `advance_trade_decision`/target/SL fields
- **Expected Result** (current bug): Unlike the user-facing `createStrategy` service (which forces `target_pts:500, sl_pts:500, target_type:"POINTS", target_pct:2, sl_pct:2` when `advance_trade_decision` is falsy), the admin path saves the strategy with these fields left at raw schema defaults (or `undefined` if the schema has no defaults) — potential inconsistency for downstream Redis sync (`syncAllDeploymentsToRedis` reads `target_pts`/`sl_pts` directly off the strategy).

#### TC-ADM-013: `getUserAccounts`/`getUserStrategies`/`getUserDeployments`/`getUserTrades`/`getUserLedger` correctly scope to `:userId` path param
- **Category**: Security
- **Priority**: P1
- **Steps**: Admin fetches sub-resources for a specific `userId`; verify no cross-contamination with other users' data
- **Expected Result**: All filters correctly use `filter.user_id = req.params.userId`.

#### TC-ADM-014: Regular (non-admin) user cannot use admin sub-resource creation endpoints as a privilege-escalation path
- **Category**: Security
- **Priority**: P0
- **Steps**: A regular user, without admin role, attempts `POST /api/admin/users/:ownUserId/accounts`
- **Expected Result**: Blocked entirely by `isAdmin` middleware before reaching the controller — regardless of `:userId` matching the caller's own ID.

### RBAC Cross-Cutting

#### TC-ADM-015: `authorize()` permission middleware exists but is wired to zero routes
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #41
- **Steps**: Audit every route file for an import of `authorizationMiddleware.js`'s `authorize()`
- **Expected Result** (confirmed gap): No route in the application imports/uses `authorize([...])`; all authorization is ad-hoc via scattered `isAdmin`/`checkAdmin()` calls. Role/Permission data model (`role.js`, `permission.js`) exists but has no enforcement point — treat any route lacking an explicit manual admin check as having zero authorization beyond authentication.

#### TC-ADM-016: A route that forgets a manual admin check is fully unprotected (illustrative)
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #41
- **Steps**: Enumerate all mutating routes across `accountRoute.js`, `strategyRoute.js`, `deploymentRoute.js`, `brokerRoute.js`, etc.; confirm each relies solely on `authenticate` + service-layer `user_id` scoping, with admin-only actions distinguished only by whichever controllers happen to call `isAdmin`/pass `isAdmin=true`
- **Expected Result**: Document any inconsistency found (e.g., a future route added without the manual check would have no authorization at all, since the decorative RBAC system provides no defense-in-depth).
