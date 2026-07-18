# BackTestApp — Accounts & Ledger — Test Case Plan

## Scope
Covers `Account` CRUD (`/api/accounts`) and `Ledger` money-movement operations (`/api/ledger`) in BackTestApp: account creation with broker/type rules, balance queries, deposit, withdraw, transfer, commission configuration, and cascading deletes. All endpoints require `authenticate` middleware (JWT bearer or PAT).

## Prerequisites
- BackTestApp running with MongoDB connected, at least one authenticated user (JWT access token) and one admin user
- At least one internal broker ("Cobra Trades", `is_internal: true`) auto-provisioned or pre-created
- Optional: a second user account to test cross-user isolation (IDOR checks)
- Tool capable of firing concurrent HTTP requests (e.g., `autocannon`, parallel `curl`, or a small script) for race-condition tests

## Test Cases

### Account Creation

#### TC-ACC-001: Create PAPER account auto-assigns internal broker
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/accounts` with `{account_name, account_type:"PAPER", initial_balance:100000}` (no `broker_id`)
- **Expected Result**: Account created with `broker_id` pointing to the internal "Cobra Trades" broker; `current_balance` defaults to `initial_balance`.

#### TC-ACC-002: Create SIMULATION account auto-assigns internal broker
- **Category**: Functional
- **Priority**: P1
- **Steps**: `POST /api/accounts` with `account_type:"SIMULATION"`
- **Expected Result**: Same internal-broker auto-assignment as PAPER.

#### TC-ACC-003: Create LIVE account requires explicit external broker_id
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/accounts` with `account_type:"LIVE"` and a valid external `broker_id`
- **Expected Result**: Account created referencing the specified broker; no auto-assignment occurs for LIVE type.

#### TC-ACC-004: Create LIVE account with internal broker_id explicitly set
- **Category**: Functional
- **Priority**: P2
- **Steps**: `POST /api/accounts` with `account_type:"LIVE"`, `broker_id` = internal broker's id
- **Expected Result**: Allowed (schema only forbids PAPER/SIMULATION from using non-internal brokers, not the reverse) — verify actual behavior matches or flag as a gap if LIVE+internal broker is nonsensical.

#### TC-ACC-005: Create PAPER/SIMULATION account with explicit external broker_id — should be rejected
- **Category**: Negative
- **Priority**: P0
- **Steps**: `POST /api/accounts` with `account_type:"PAPER"` and `broker_id` = an external (non-internal) broker
- **Expected Result**: Save fails with "Only LIVE accounts can be associated with external brokers..." error from the model's `pre("save")` hook.

#### TC-ACC-006: `current_balance` defaults to `initial_balance` when not supplied
- **Category**: Functional
- **Priority**: P1
- **Steps**: `POST /api/accounts` omitting `current_balance`
- **Expected Result**: `current_balance === initial_balance` on the created document.

#### TC-ACC-007: `current_balance` can be explicitly overridden on create
- **Category**: Functional
- **Priority**: P2
- **Steps**: `POST /api/accounts` with `initial_balance:100000, current_balance:50000`
- **Expected Result**: Document saved with the two fields differing as supplied (no validation prevents mismatch at creation).

#### TC-ACC-008: Negative `initial_balance` is accepted — no validation
- **Category**: Negative / Regression
- **Priority**: P1
- **Related Issue**: #45
- **Steps**: `POST /api/accounts` with `initial_balance: -5000`
- **Expected Result** (current bug): Account is created successfully with a negative balance; schema has no `min: 0` validator and service performs no explicit rejection.
- **Notes**: Should fail once fix for #45 lands; keep as regression guard.

#### TC-ACC-009: Missing required fields rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/accounts` omitting `account_name`, or omitting `account_type`, or omitting `initial_balance` (each in a separate request)
- **Expected Result**: Mongoose validation error (`required`) surfaced as 4xx.

#### TC-ACC-010: Invalid `account_type` enum value rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/accounts` with `account_type: "CRYPTO"`
- **Expected Result**: Schema enum validation error.

#### TC-ACC-011: Invalid `broker_id` (nonexistent ObjectId) rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `POST /api/accounts` with `account_type:"LIVE", broker_id:"<random valid-looking ObjectId that doesn't exist>"`
- **Expected Result**: `pre("save")` hook's `Broker.findById` returns null → "Associated broker not found" error.

#### TC-ACC-012: `commission_type` defaults to PERCENTAGE, `commission_rate` defaults to 0
- **Category**: Functional
- **Priority**: P2
- **Steps**: `POST /api/accounts` omitting commission fields
- **Expected Result**: Defaults applied as documented.

#### TC-ACC-013: Invalid `commission_type` enum rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `POST /api/accounts` with `commission_type: "FIXED"`
- **Expected Result**: Enum validation error (`PERCENTAGE` | `FLAT` only).

### Account Read / List

#### TC-ACC-014: List accounts scoped to authenticated user only
- **Category**: Security
- **Priority**: P0
- **Steps**: User A creates 2 accounts; User B calls `GET /api/accounts`
- **Expected Result**: User B sees only their own accounts (filter includes `user_id: userId` for non-admin); User A's accounts are absent.

#### TC-ACC-015: Get account by Mongo `_id` or by custom `account_id` string
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /api/accounts/:id` using the Mongo `_id`, then again using the `account_id` string field
- **Expected Result**: Both resolve to the same account document.

#### TC-ACC-016: Get another user's account by ID returns not-found (IDOR check)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B calls `GET /api/accounts/:idBelongingToUserA`
- **Expected Result**: 404 / null — query includes `user_id: userId` scoping for non-admin.

#### TC-ACC-017: `GET /api/accounts/:id/balance` returns current balance
- **Category**: Functional
- **Priority**: P1
- **Steps**: Call balance endpoint after a known deposit
- **Expected Result**: Returned balance matches `current_balance` in DB.

#### TC-ACC-018: ReDoS via `search` query param on accounts list
- **Category**: Security
- **Priority**: P1
- **Related Issue**: #43
- **Steps**: `GET /api/accounts?search=` + a crafted catastrophic-backtracking pattern (e.g., `(a+)+$` style content) against `account_name`/`description` search fields
- **Expected Result** (current bug): Regex is built via `new RegExp(query.search, "i")` with no escaping; a malicious pattern can hang the event loop. Verify response latency degrades drastically / times out.

### Account Update

#### TC-ACC-019: Non-admin can update whitelisted fields only
- **Category**: Functional
- **Priority**: P0
- **Steps**: `PATCH /api/accounts/:id` with `{account_name:"New", current_balance:999999}`
- **Expected Result**: `account_name` updates; `current_balance` is silently dropped (not in `USER_UPDATABLE_FIELDS`) — verify response reflects unchanged balance.

#### TC-ACC-020: Admin can update `current_balance`/`initial_balance`/`account_type` directly
- **Category**: Functional
- **Priority**: P1
- **Steps**: As an admin-flagged request, `PATCH` an account with `current_balance` and `account_type`
- **Expected Result**: Update succeeds using `ADMIN_UPDATABLE_FIELDS` allowlist.

#### TC-ACC-021: Update with no valid fields returns explicit error
- **Category**: Negative
- **Priority**: P2
- **Steps**: `PATCH /api/accounts/:id` with `{}` or only disallowed fields (e.g., `{user_id:"..."}`)
- **Expected Result**: "No valid fields provided for update" error.

#### TC-ACC-022: Changing `broker_id` on a PAPER account to an external broker rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `PATCH` a PAPER account's `broker_id` (as admin) to an external broker
- **Expected Result**: Service performs the same LIVE/internal-broker check before `findOneAndUpdate`; rejected with descriptive error.

#### TC-ACC-023: Changing `broker_id` to a nonexistent broker rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `PATCH` with `broker_id` set to a random nonexistent ObjectId
- **Expected Result**: "Associated broker not found" error before update is applied.

### Account Deletion & Cascade

#### TC-ACC-024: Deleting an account cascades to deployments/trades/positions/ledgers
- **Category**: Functional
- **Priority**: P0
- **Steps**: Create account → deployment → trades/positions/ledger entries under it; `DELETE /api/accounts/:id`
- **Expected Result**: All deployments referencing the account are deleted; all trades/positions/ledgers linked either via those deployment IDs or directly via `account_id` are deleted; account itself removed; Redis deployment sync (`syncAllDeploymentsToRedis`) is triggered afterward.

#### TC-ACC-025: Deleting nonexistent account returns null/404 gracefully
- **Category**: Negative
- **Priority**: P2
- **Steps**: `DELETE /api/accounts/:bogusId`
- **Expected Result**: Handled gracefully (no crash), appropriate 404.

#### TC-ACC-026: Deleting another user's account is blocked (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B attempts `DELETE /api/accounts/:idBelongingToUserA`
- **Expected Result**: Scoped query (`user_id: userId`) finds nothing; no deletion occurs; 404 returned.

#### TC-ACC-027: Redis sync failure during cascade delete does not fail the HTTP request
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate Redis being unreachable during account deletion
- **Expected Result**: Error is caught and logged (`Failed to sync deployments to Redis after account deletion`); account deletion itself still succeeds and API returns success.

### Ledger — Deposit

#### TC-LDG-001: Deposit increases balance and creates a ledger entry
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/ledger/deposit` with `{accountId, amount:1000, description}`
- **Expected Result**: `account.current_balance` increases by `amount`; a `Ledger` row is created with `transaction_type:"DEPOSIT"`, correct `opening_balance`/`closing_balance`.

#### TC-LDG-002: Deposit with zero or negative amount rejected
- **Category**: Negative
- **Priority**: P0
- **Steps**: `POST /api/ledger/deposit` with `amount: 0`, then `amount: -100`
- **Expected Result**: "Amount must be greater than zero" error, no balance change.

#### TC-LDG-003: Deposit to nonexistent/foreign account rejected
- **Category**: Security
- **Priority**: P0
- **Steps**: `POST /api/ledger/deposit` with `accountId` belonging to another user
- **Expected Result**: Lookup is scoped by `user_id: userId`; "Account not found" error.

#### TC-LDG-004: Deposit ledger entry auto-links to the account's "Manual" deployment if one exists
- **Category**: Functional
- **Priority**: P2
- **Steps**: Ensure a `Deployment` with `deployment_name: "Manual"` exists for the account; deposit; inspect ledger entry
- **Expected Result**: Ledger entry carries `deployment_id`, `strategy_id`, `user_symbol_id`, `symbol` copied from that Manual deployment.

#### TC-LDG-005: Deposit without a "Manual" deployment omits deployment linkage fields
- **Category**: Functional
- **Priority**: P2
- **Steps**: Deposit into an account with no "Manual" deployment
- **Expected Result**: Ledger entry has no `deployment_id`/`strategy_id` fields set.

#### TC-LDG-006: Concurrent deposits — lost update race
- **Category**: Regression / Security
- **Priority**: P0
- **Related Issue**: #35
- **Preconditions**: Account balance known, e.g. 1000
- **Steps**: Fire 10 concurrent `POST /api/ledger/deposit` requests of `amount:100` each at the same account
- **Expected Result** (current bug potential): Because deposit uses read→mutate→`.save()` with no atomic `$inc` or transaction, concurrent requests may read the same stale `current_balance`, and the final balance can be less than `opening + 10*100` (lost updates), even though 10 Ledger rows are created (one per request) recording amounts that don't sum to the actual balance delta.
- **Notes**: Compare final DB balance vs sum of ledger `change_in_balance` entries to detect the discrepancy.

### Ledger — Withdraw

#### TC-LDG-007: Withdraw decreases balance and creates a WITHDRAW ledger entry
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/ledger/withdraw` with a valid `amount` ≤ balance
- **Expected Result**: Balance decreases; ledger entry `transaction_type:"WITHDRAW"`, `change_in_balance` negative.

#### TC-LDG-008: Withdraw more than current balance rejected
- **Category**: Negative
- **Priority**: P0
- **Steps**: `POST /api/ledger/withdraw` with `amount` > `current_balance`
- **Expected Result**: "Insufficient funds" error; no balance change.

#### TC-LDG-009: Withdraw zero/negative amount rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `amount: 0` and `amount: -50`
- **Expected Result**: "Amount must be greater than zero" error.

#### TC-LDG-010: Concurrent withdrawals can overdraw the account (double-spend)
- **Category**: Regression / Security
- **Priority**: P0
- **Related Issue**: #35
- **Preconditions**: Account balance = 1000
- **Steps**: Fire 2 concurrent `POST /api/ledger/withdraw` requests of `amount:800` each
- **Expected Result** (current bug potential): Both requests may read `current_balance=1000`, both pass the `< amount` check, and both `.save()` — resulting in a final balance of `1000-800=200` (only one withdrawal applied) or worse, a negative balance if save ordering differs, while 2 successful WITHDRAW ledger rows totaling 1600 exist against a 1000 starting balance. This is the account's most exploitable race condition.
- **Notes**: Assert `sum(ledger.change_in_balance) != (finalBalance - initialBalance)` to prove the lost update.

#### TC-LDG-011: Withdraw from foreign account rejected (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: Attempt to withdraw from an account not owned by the caller
- **Expected Result**: "Account not found" (scoped lookup fails).

### Ledger — Transfer

#### TC-LDG-012: Transfer moves funds between two owned accounts
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/ledger/transfer` with `{fromAccountId, toAccountId, amount}`, both owned by caller
- **Expected Result**: `fromAccount` balance decreases, `toAccount` balance increases by `amount`; two ledger rows created (`TRANSFER_OUT`, `TRANSFER_IN`) with correct opening/closing balances and reciprocal descriptions.

#### TC-LDG-013: Transfer with insufficient funds in source account rejected
- **Category**: Negative
- **Priority**: P0
- **Steps**: `amount` > `fromAccount.current_balance`
- **Expected Result**: "Insufficient funds" error before any writes occur.

#### TC-LDG-014: Transfer to nonexistent destination account rejected after debit check but before debit applied
- **Category**: Negative
- **Priority**: P1
- **Steps**: Valid `fromAccountId`, bogus `toAccountId`
- **Expected Result**: "Destination account not found" error; verify `fromAccount` balance is untouched (error thrown before the debit `.save()` — confirm ordering in code).

#### TC-LDG-015: Self-transfer using identical Mongo `_id` on both sides rejected
- **Category**: Negative
- **Priority**: P1
- **Related Issue**: #47
- **Steps**: `POST /api/ledger/transfer` with `fromAccountId === toAccountId` (same string form)
- **Expected Result**: "Source and destination accounts must be different" error triggers correctly when the two raw identifiers are string-identical.

#### TC-LDG-016: Self-transfer bypass using mixed identifier forms (Mongo `_id` vs custom `account_id`)
- **Category**: Regression / Negative
- **Priority**: P0
- **Related Issue**: #47
- **Steps**: `POST /api/ledger/transfer` with `fromAccountId` = the account's Mongo `_id` string and `toAccountId` = the *same account's* custom `account_id` string (or vice versa)
- **Expected Result** (current bug): The naive `fromAccountId === toAccountId` string comparison does not catch this, since the two representations differ as raw strings even though they resolve to the same account document. Transfer proceeds, producing confusing duplicate `TRANSFER_OUT`/`TRANSFER_IN` ledger entries on the same account and compounding the race condition in TC-LDG-018.
- **Notes**: Fix should resolve both accounts first and compare `fromAccount._id.equals(toAccount._id)`.

#### TC-LDG-017: Transfer between accounts owned by different users rejected (cross-account IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User A attempts to transfer from their own account to an account owned by User B using `toAccountId`
- **Expected Result**: Both `fromAccount`/`toAccount` lookups are scoped to `user_id: userId` (the caller) — a `toAccountId` belonging to another user will not be found under the caller's scope, so "Destination account not found" is returned (transfer cannot cross users at all via this scoping, confirm this is actually correct behavior or a UX gap if cross-user transfer is a legitimate intended use case).

#### TC-LDG-018: Concurrent transfers — non-atomic double debit/credit
- **Category**: Regression / Security
- **Priority**: P0
- **Related Issue**: #35
- **Steps**: Fire 2 concurrent transfer requests moving funds out of the same source account simultaneously
- **Expected Result** (current bug potential): Same lost-update race as deposit/withdraw — both requests can read stale `fromAccount.current_balance`, resulting in over-debit or under-debit versus the sum of created ledger rows.

#### TC-LDG-019: Transfer amount zero/negative rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: `amount: 0`, `amount: -10`
- **Expected Result**: "Amount must be greater than zero" error.

### Ledger — List / Filter

#### TC-LDG-020: List ledger entries scoped to caller's `user_id`
- **Category**: Security
- **Priority**: P0
- **Steps**: `GET /api/ledger` as User B while User A has ledger history
- **Expected Result**: Only User B's entries returned.

#### TC-LDG-021: Filter ledger by `accountId`, `strategyId`, `deploymentId`, `symbol`
- **Category**: Functional
- **Priority**: P1
- **Steps**: Create entries across multiple accounts/symbols; query each filter independently
- **Expected Result**: Each filter correctly narrows results; unmatched `accountId` (foreign/nonexistent) returns an empty paginated result rather than erroring.

#### TC-LDG-022: Filter ledger by `type=credit` / `type=debit`
- **Category**: Functional
- **Priority**: P2
- **Steps**: `GET /api/ledger?type=credit` and `?type=debit`
- **Expected Result**: `credit` returns only rows with `change_in_balance > 0`; `debit` only `< 0`.

#### TC-LDG-023: `GET /api/ledger/:id` accepts Mongo `_id` or `ledger_id`
- **Category**: Functional
- **Priority**: P2
- **Steps**: Fetch a ledger row by each identifier form
- **Expected Result**: Both resolve to the same populated document (`account_id`, `trade_id` populated).

#### TC-LDG-024: Pagination fields (`page`, `limit`, `pages`, `total`) are correct
- **Category**: Functional
- **Priority**: P2
- **Steps**: Create >1 page of ledger rows; request page 2
- **Expected Result**: Correct slice returned with accurate `pagination` metadata.

### Commission Handling (cross-cutting with Trade creation)

#### TC-LDG-025: Account `commission_rate`/`commission_type` is applied at trade time, not ledger time
- **Category**: Functional
- **Priority**: P1
- **Steps**: Set account `commission_type:"PERCENTAGE", commission_rate:0.1`; create a trade referencing this account; inspect resulting ledger/trade commission field
- **Expected Result**: Confirm commission is computed from the account's settings during trade/ledger creation (cross-reference with `BackTestApp-trades-positions.md` for the exact computation) — this file only verifies account-level configuration surface, not trade math.

#### TC-LDG-026: Unauthenticated request to any ledger/account endpoint rejected
- **Category**: Security
- **Priority**: P0
- **Steps**: Call each `/api/accounts/*` and `/api/ledger/*` endpoint with no `Authorization` header
- **Expected Result**: 401 from `authenticate` middleware.
