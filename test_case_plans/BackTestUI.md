# BackTestUI (React Frontend) — Test Case Plan

## Scope
Covers `BackTest/BackTestUI`, the React/TypeScript SPA that is the primary human interface to BackTestApp. Includes authentication/MFA flows, the global `api.ts` fetch wrapper (token refresh interceptor), dashboard, accounts/strategies/deployments/brokers/symbols list & detail views, transaction/position browsing, live candlestick charting, live WebSocket ticker consumption, and deployment-creation dialog defaults.

## Prerequisites
- BackTestApp reachable at `/backtestapp` (as proxied by nginx in production, or directly in dev)
- At least one seeded user account (e.g., the "Developer Seed Profile" admin/standard user shown on the login screen) and test data for accounts, strategies, deployments, symbols, brokers
- Browser dev tools / network throttling capability for testing token refresh and WebSocket reconnect behavior

## Test Cases

### Authentication & MFA Flow

#### TC-UI-001: Valid login without MFA enabled redirects into the MFA SETUP screen (forced enrollment), not directly to the dashboard
- **Category**: Functional
- **Priority**: P0
- **Steps**: Log in with valid credentials for a user with `is_mfa_enabled:false`
- **Expected Result**: `LoginView`'s `handleSubmit` checks `userRes.data.is_mfa_enabled` post-login and, if false, forces `view→'mfa_setup'` rather than calling `onLoginSuccess()` — confirms the UI attempts to nudge every user toward MFA enrollment on first login, though (per TC-UI-004) this can be skipped.

#### TC-UI-002: Valid login for a user with MFA already enabled goes straight to the dashboard
- **Category**: Functional
- **Priority**: P0
- **Steps**: Log in with a user who has `is_mfa_enabled:true` and no `mfaRequired` challenge triggered incorrectly
- **Expected Result**: Wait — if MFA is enabled, the backend's `/auth/login` should itself return `mfaRequired:true` BEFORE reaching the `is_mfa_enabled` check client-side; confirm `data.mfaRequired` short-circuits into `view→'mfa_verify'` first, and the `getMe`-based `is_mfa_enabled` check is only relevant for the NON-mfaRequired login response path (i.e., only reachable when the backend doesn't enforce MFA-required login checks — cross-reference `BackTestApp-iam-auth.md` for the server-side source of truth on when `mfaRequired` is actually set).

#### TC-UI-003: MFA-required login shows the 6-digit TOTP verification screen and calls `mfa.loginVerify` with the ORIGINAL password re-sent
- **Category**: Functional
- **Priority**: P0
- **Steps**: Log in as an MFA-enabled user; enter a valid TOTP code
- **Expected Result**: `handleMfaVerifySubmit` calls `api.mfa.loginVerify(email, password, totpCode)` — note the password is held in component state and RE-SENT alongside the TOTP code (not just a short-lived MFA challenge token) — confirms both factors are verified together in one call; successful verification stores both tokens and calls `onLoginSuccess()`.

#### TC-UI-004: "Skip for now" on the forced MFA-setup screen allows bypassing enrollment entirely
- **Category**: Regression / Security
- **Priority**: P1
- **Steps**: On the `mfa_setup` screen (post-login, MFA not yet enabled), click "Skip for now"
- **Expected Result**: `onLoginSuccess()` called directly, bypassing `verifySetup` — the user proceeds into the app with MFA still disabled; combined with the earlier "forced setup" framing, this is a soft-nudge, not an enforced requirement — document as an intentional UX choice, but flag for review if MFA was intended to be mandatory anywhere in the actual security model (cross-check `BackTestApp-iam-auth.md`'s MFA test cases for whether any backend routes actually require MFA to be enabled vs. this being purely a UI suggestion).

#### TC-UI-005: MFA setup QR code and manual secret are correctly rendered and copy-to-clipboard works
- **Category**: Functional
- **Priority**: P2
- **Steps**: Reach the `mfa_setup` screen with `mfaSetupData` populated; click the copy icon
- **Expected Result**: QR image renders from `qrCodeDataUrl`; clicking copy writes `tempSecret` to the clipboard and shows a checkmark confirmation for 2 seconds.

#### TC-UI-006: Invalid TOTP code on setup-verification shows an inline error without losing the QR/secret display
- **Category**: Negative
- **Priority**: P1
- **Steps**: Enter an incorrect 6-digit code during `mfa_setup`
- **Expected Result**: Error message shown (`err.message`); `mfaSetupData` remains populated so the user can retry against the same QR/secret without needing to restart setup (`verifySetup` failure doesn't invalidate/regenerate the temp secret from the client's perspective).

#### TC-UI-007: "Developer Seed Profiles" quick-fill buttons expose real admin and standard-user credentials directly on the public login screen
- **Category**: Security (observational — no corresponding issues.md entry, flag as a new finding)
- **Priority**: P1
- **Steps**: Load the login page without authenticating
- **Expected Result**: Two buttons pre-fill `admin@cobratrades.com`/`adminpassword123` and `user@cobratrades.com`/`userpassword123` directly into the login form — if this build is ever deployed to a production/public-facing environment without being stripped, these are hardcoded, guessable, publicly-visible admin credentials requiring zero effort to discover (view page source). Recommend flagging for removal or gating behind a `NODE_ENV!=='production'` check before any real deployment; verify current build process doesn't already strip this (if it does, downgrade this test to informational-only for the dev build).

#### TC-UI-008: Signup flow chains directly into auto-login, then the same forced-MFA-setup nudge
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete the signup form with a new email/username/password
- **Expected Result**: `api.auth.signup` internally calls `this.login(email, password)` after a successful signup response — new users land in `mfa_setup` immediately without a separate manual login step.

#### TC-UI-009: Logout clears both tokens from `localStorage` even if the server-side `/auth/logout` call fails
- **Category**: Negative (positive control)
- **Priority**: P1
- **Steps**: Simulate a network failure during `handleLogout`'s `api.auth.logout()` call
- **Expected Result**: `logout()`'s `finally` block removes `accessToken`/`refreshToken` from `localStorage` REGARDLESS of whether the network call succeeded — client-side session termination is not blocked by server reachability (though the server-side session/refresh-token record may remain valid until natural expiry if the revocation call never reached the server — cross-reference `BackTestApp-iam-auth.md` session-revocation tests for the server-side gap this could create).

### Global Fetch Interceptor & Token Refresh

#### TC-UI-010: A 401 on any authenticated request (except auth endpoints themselves) triggers a transparent token refresh and automatic retry
- **Category**: Functional
- **Priority**: P0
- **Steps**: Let the access token expire naturally (or force a 401 from the backend); make an authenticated API call (e.g., `api.accounts.list()`)
- **Expected Result**: The global `window.fetch` override intercepts the 401, calls `/auth/refresh-token` with the stored refresh token, updates `localStorage`'s `accessToken`, and retries the ORIGINAL request with the new token — the caller's promise resolves successfully with no visible interruption, assuming the refresh itself succeeds.

#### TC-UI-011: Concurrent requests that all 401 simultaneously trigger only ONE refresh call (deduplication via `refreshPromise`)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Fire 5 concurrent authenticated API calls at the moment the access token expires
- **Expected Result**: Only ONE `/auth/refresh-token` network call is observed (the shared `refreshPromise` module-level variable ensures subsequent 401s await the SAME in-flight refresh rather than each starting their own) — all 5 original requests are correctly retried with the singular new token once the shared refresh resolves.

#### TC-UI-012: `/auth/refresh-token`, `/auth/login`, `/auth/signup`, `/auth/mfa/login-verify` responses are explicitly excluded from the 401-retry interceptor to avoid infinite loops
- **Category**: Regression (positive control)
- **Priority**: P1
- **Steps**: Force a 401 directly from the LOGIN endpoint itself (e.g., wrong password)
- **Expected Result**: The interceptor's `urlString.includes(...)` exclusion list correctly skips the refresh-retry logic for these paths — a failed login attempt returns its 401 straight through to the caller (`handleResponse` throws an `AuthError`/generic error) rather than attempting a nonsensical "refresh and retry the login call" loop.

#### TC-UI-013: A refresh-token call that itself returns 401/403/400 is treated as "session expired" and triggers full logout + `auth-unauthorized` event
- **Category**: Functional
- **Priority**: P0
- **Steps**: Force the refresh token itself to be invalid/expired (e.g., simulate its expiry, or revoke it server-side) then trigger any authenticated request
- **Expected Result**: `AuthError` thrown inside the `refreshPromise` IIFE; caught by the outer catch, which checks `err instanceof AuthError || err?.isAuthError` and clears both tokens + dispatches `auth-unauthorized` — `App.tsx`'s listener sets `isAuthenticated=false`, redirecting the user to the login screen.

#### TC-UI-014: A NETWORK error (not an auth error) during token refresh does NOT log the user out — distinguishes connectivity issues from session expiry
- **Category**: Negative (positive control)
- **Priority**: P1
- **Steps**: Simulate a network-level failure (e.g., offline/DNS failure) specifically on the `/auth/refresh-token` call, while the actual refresh token is still valid
- **Expected Result**: The inner `try/catch` around the refresh `fetch` call explicitly re-throws the raw network error (NOT wrapped as `AuthError`) — the outer catch's `if (err instanceof AuthError...)` check is false, so NO logout/token-clear happens; the user stays "logged in" (with a stale token) and can retry once connectivity returns, rather than being incorrectly kicked to the login screen due to a transient network blip.

#### TC-UI-015: `ensureValidToken` proactively refreshes when the JWT's `exp` claim is within 30 seconds of expiry, avoiding a guaranteed-401 round-trip
- **Category**: Functional
- **Priority**: P1
- **Steps**: With an access token whose `exp` is 15 seconds in the future, call `api.auth.ensureValidToken()`
- **Expected Result**: Client-side JWT payload decoding (base64url) correctly computes `expTime - Date.now() < 30000` as true, proactively calling `refreshToken()` BEFORE the token is actually expired — used by both the periodic 10-minute interval refresh and the WebSocket connection setup (TC-UI-018) to minimize failed-then-retried requests.

#### TC-UI-016: A malformed/non-JWT-shaped stored token does not crash `ensureValidToken` — degrades to returning the token as-is
- **Category**: Negative
- **Priority**: P2
- **Steps**: Manually corrupt `localStorage`'s `accessToken` to a non-JWT string; call `ensureValidToken`
- **Expected Result**: The base64url-decode/`JSON.parse` attempt is wrapped in try/catch — on failure, logs the error and falls through to `return token;` (the corrupted value itself) rather than throwing — the subsequent API call using this bad token will naturally 401 and go through the normal refresh-interceptor path instead.

#### TC-UI-017: Periodic background token refresh runs every 10 minutes while authenticated, and stops immediately on logout
- **Category**: Functional
- **Priority**: P2
- **Steps**: Stay logged in and idle for >10 minutes; then log out and verify no further refresh calls occur
- **Expected Result**: `setInterval` fires `api.auth.refreshToken()` every 600000ms while `isAuthenticated`; the `useEffect` cleanup (`clearInterval`) on the `isAuthenticated` dependency change correctly halts this background timer immediately upon logout — no orphaned interval continues firing refresh calls with a now-cleared token.

### Live WebSocket Ticker Feed

#### TC-UI-018: On authentication, the app opens a WebSocket to `/backtestapp/ws?token=<accessToken>` using `wss:`/`ws:` matching the page's own protocol
- **Category**: Functional
- **Priority**: P0
- **Steps**: Log in over HTTPS; inspect the WebSocket connection URL
- **Expected Result**: `wsProto` derived from `window.location.protocol` ensures `wss:` is used whenever the page itself is served over HTTPS (avoiding mixed-content browser blocking); the token is fetched via `ensureValidToken()` FIRST (proactively refreshing if near-expiry) before constructing the URL, minimizing the chance of connecting with an already-stale token.

#### TC-UI-019: `broker_updated` WebSocket events trigger a full `loadData()` refresh and a custom DOM event for other components
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete an Upstox OAuth flow in another tab/window (which publishes `broker_updated` to Redis per `microservice-upstox-auth.md` TC-UPX-005, presumably relayed to this WS channel by BackTestApp); observe the UI
- **Expected Result**: `ws.onmessage` detects `msg.event==='broker_updated'`, dispatches a `broker-updated` CustomEvent (for any listening components, e.g., `BrokersListView`) AND calls `loadData()` to refresh accounts/strategies/brokers/etc. — the UI reflects the new broker connection without a manual page refresh.

#### TC-UI-020: Live price ticks (`instrument_token`+`last_price` messages) update ONLY the matching symbol's `lastPrice` in state, leaving others untouched
- **Category**: Functional
- **Priority**: P0
- **Steps**: Receive a tick for `instrument_token:"X"`; verify only the symbol with matching `instrumentToken` updates
- **Expected Result**: The `setSymbols` functional update maps over the array, updating only the matched entry — all other symbols' `lastPrice` values are unaffected, avoiding unnecessary re-renders/state churn for unrelated symbols.

#### TC-UI-021: Malformed JSON on the WebSocket is caught and logged without crashing the UI or the connection
- **Category**: Negative
- **Priority**: P1
- **Steps**: Simulate the server sending a non-JSON WS frame
- **Expected Result**: `JSON.parse` failure caught inside `onmessage`'s own try/catch; error logged to console; connection remains open for subsequent valid messages.

#### TC-UI-022: WebSocket disconnect triggers an automatic reconnect after a fixed 3-second delay
- **Category**: Functional
- **Priority**: P1
- **Steps**: Force-close the WS connection (e.g., server restart, network blip)
- **Expected Result**: `ws.onclose` schedules `connect()` again after 3000ms via `setTimeout`; verify reconnect actually re-fetches a FRESH token via `ensureValidToken()` (not reusing a potentially now-stale token from the original connection attempt) — confirms resilience to transient network drops without requiring a manual page reload.

#### TC-UI-023: Component unmount (or `isAuthenticated` flipping to false) cleanly disposes the WebSocket without triggering a reconnect loop
- **Category**: Regression
- **Priority**: P1
- **Steps**: Log out while the WS connection is open or mid-reconnect-backoff
- **Expected Result**: The `useEffect` cleanup sets `isDisposed=true`, clears any pending `reconnectTimeout`, and closes the socket if open/connecting — the `onclose` handler's own reconnect-scheduling checks `isDisposed` first and no-ops, preventing a reconnect attempt with a now-invalid/absent token after logout.

### Deployment Creation Dialog — Risky Defaults (Critical Regression)

#### TC-UI-024: The "Deploy Strategy" dialog defaults `mode` to `'live'` — a brand-new deployment form starts pre-selected for REAL MONEY trading
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #33
- **Steps**: Click "Deploy Strategy" to open the creation form; inspect the pre-selected mode WITHOUT touching the mode selector
- **Expected Result** (current bug): `useState<'live'|'paper'|'backtest'>('live')` initializes the mode dropdown/selector to `'live'` by default — a user who quickly fills in the strategy/account/symbol fields and submits without deliberately reviewing the mode selector will deploy a LIVE, real-broker-money strategy by default, rather than the intuitively safer default of `'paper'` (simulated) or `'backtest'`. This is especially risky combined with TC-UI-025 (also defaulting to `'active'`), meaning the "path of least resistance" for a new/rushed user is: real money, immediately running.

#### TC-UI-025: The "Deploy Strategy" dialog defaults `initialStatus` to `'active'` — a brand-new deployment starts RUNNING immediately upon creation, not staged as scheduled/paused
- **Category**: Regression / Critical Bug
- **Priority**: P0
- **Related Issue**: #33
- **Steps**: Open the creation form; inspect the pre-selected initial status without touching it
- **Expected Result** (current bug): `useState<'active'|'paused'|'stopped'>('active')` — combined with the `mode:'live'` default (TC-UI-024), the WORST-CASE default combination for a brand-new, never-reviewed deployment is "LIVE mode, ACTIVE status" — i.e., placing real trades against a real broker account starting the moment the form is submitted. A safer UX default would be `mode:'paper'` and/or `status:'paused'`/`'stopped'`, requiring an explicit, deliberate opt-in step to go live and/or start running.
- **Notes**: Cross-reference `BackTestApp-strategies-deployments.md` for the corresponding backend-level test of default values if the client omits `strategy_mode`/`current_status` in the API payload entirely (this UI test is specifically about the FORM's pre-filled state, which is a UX/human-factors risk distinct from any backend default).

#### TC-UI-026: Form reset after successful submission re-applies the SAME risky defaults (`mode:'live'`, `initialStatus:'active'`) for the NEXT deployment in the same session
- **Category**: Regression
- **Priority**: P1
- **Related Issue**: #33
- **Steps**: Successfully submit one deployment, then immediately open the form again for a second deployment
- **Expected Result**: `handleSubmit`'s reset block explicitly calls `setMode('live')` and `setInitialStatus('active')` — every subsequent deployment created in the same session starts from the same risky baseline, with no "sticky" memory of the previous deployment's (possibly safer) mode/status choice.

#### TC-UI-027: Selecting "backtest" mode reveals `backtestDate`/`backtestSpeed` fields; selecting "live"/"paper" hides them
- **Category**: Functional
- **Priority**: P1
- **Steps**: Toggle the mode selector between all three options
- **Expected Result**: `newStrat.backtestDate`/`backtestSpeed` are only populated (`mode==='backtest' ? value : undefined`) when backtest mode is selected — the payload sent to `onAddStrategy`/`api.deployments.create` correctly omits these fields for live/paper deployments.

#### TC-UI-028: Dynamic symbol control (option auto-resolution) requires `underlyingSymbolId` and a valid `YYYY-MM-DD` expiry before allowing submission
- **Category**: Negative
- **Priority**: P1
- **Steps**: Enable "dynamic symbol" without selecting an underlying, and separately with an invalid expiry format
- **Expected Result**: `handleSubmit`'s guard clauses (`if (dynamicSymbol && !underlyingSymbolId) return;` and the regex check `/^\d{4}-\d{2}-\d{2}$/.test(optionExpiry)`) block submission silently (no error message shown to the user beyond the form simply not submitting) — UX gap: consider surfacing an inline validation message rather than a silent no-op.

#### TC-UI-029: Non-dynamic (static symbol) deployment requires at least one symbol to be selected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Leave `selectedSymbols` empty with dynamic symbol control disabled; attempt submit
- **Expected Result**: `if (!dynamicSymbol && selectedSymbols.length===0) return;` blocks submission — same silent-no-op UX gap as TC-UI-028.

#### TC-UI-030: `ATM` moneyness forces `offset` to exactly 1 regardless of the user's selected offset value
- **Category**: Functional
- **Priority**: P2
- **Steps**: Select `moneyness:'ATM'` with a non-default `offset` value (e.g., 5) set beforehand
- **Expected Result**: `handleSubmit`'s payload construction uses `moneyness === 'ATM' ? 1 : offset` — confirms ATM strike selection always resolves to offset 1 (the nearest strike) regardless of what the (likely hidden/disabled for ATM) offset control shows; verify the offset input is appropriately disabled/hidden in the UI when ATM is selected to avoid user confusion.

### Accounts, Strategies, Symbols, Brokers List Views — CRUD & Navigation

#### TC-UI-031: Account creation form correctly maps UI fields (`accountType`, `initialBalance`, `commissionType/Rate`, `brokerId`) to the exact `api.accounts.create` payload shape
- **Category**: Functional
- **Priority**: P0
- **Steps**: Create a new account through `AccountsListView`'s form with all fields populated
- **Expected Result**: Payload matches `{account_name, account_type, initial_balance, description:'broker:<broker>', commission_type, commission_rate, broker_id}` — cross-reference `BackTestApp-accounts-ledger.md` for server-side validation of these exact fields.

#### TC-UI-032: Account deletion shows a confirmation and, on success, correctly redirects away from the detail view if the deleted account was currently selected
- **Category**: Functional
- **Priority**: P1
- **Steps**: Delete the account currently being viewed in `AccountDetailsView`
- **Expected Result**: `handleDeleteAccount` checks `selectedEntityId === id` and resets `selectedEntityId`/`activeScreen` back to `'accounts-list'` — avoids leaving the user stranded on a now-nonexistent entity's detail page; success toast explicitly mentions cascade deletion of deployments/trades/positions/ledgers (matching backend cascade behavior per `BackTestApp-accounts-ledger.md`).

#### TC-UI-033: Toggling an account's broker connection status (`is_active`) optimistically updates local state, but reverts silently if the server call fails
- **Category**: Negative
- **Priority**: P2
- **Steps**: Simulate `api.accounts.update` failing during `handleToggleBrokerStatus`
- **Expected Result**: `showError` toast is shown; verify whether the LOCAL `setAccounts` optimistic update (which only runs inside the `try` block, AFTER the awaited API call per current code — re-verify ordering) is actually skipped on failure — confirms no state desync between the UI's displayed status and the server's actual value after an error.

#### TC-UI-034: Strategy template (strategy DEFINITION, distinct from a deployment) creation, edit, and delete flow works independently of deployments
- **Category**: Functional
- **Priority**: P1
- **Steps**: Create/edit/delete a strategy template via `StrategyTemplatesView`
- **Expected Result**: Correctly calls `api.strategies.create/update/delete` (the strategy DEFINITION endpoints, e.g., MSB/msb_pts/liquidity_sweep templates) — distinct from `api.deployments.*` (the per-account/symbol RUNNING instances) — confirms the UI correctly models the two-tier strategy-definition vs. deployment architecture; deleting a template cascades to all its deployments per the success toast's message and backend behavior (`BackTestApp-strategies-deployments.md`).

#### TC-UI-035: Symbol activation/deactivation toggle immediately reflects in the list AND triggers a full data reload
- **Category**: Functional
- **Priority**: P1
- **Steps**: Toggle `is_active` on a tracked symbol
- **Expected Result**: Optimistic local update + toast + `loadData()` — verify no flicker/stale-data window where the optimistic update briefly shows something different from what `loadData` subsequently fetches.

#### TC-UI-036: Bulk option-symbol creation (`symbols.bulkCreate`) correctly passes range/moneyness/option-type filters
- **Category**: Functional
- **Priority**: P1
- **Steps**: Use the bulk-add UI (if present in `SymbolsListView`) to create a range of option contracts around a given underlying
- **Expected Result**: Payload matches `{symbol, range_count, range_option:'ITM'|'ATM'|'OTM'|'ALL', option_type:'Call'|'Put'|'Both', expiry}` — verify UI-to-backend enum value casing consistency (`'Call'`/`'Put'`/`'Both'` here vs. `'CE'`/`'PE'` used elsewhere in the deployment symbol-control flow — confirm this is NOT a bug but two intentionally different enum vocabularies for two different features).

#### TC-UI-037: Brokers list view reflects real-time `broker_updated` events without requiring manual refresh
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete an Upstox OAuth flow while `BrokersListView` is open
- **Expected Result**: Cross-reference TC-UI-019 — the component listens for the `broker-updated` custom DOM event and refreshes its own broker connection-status display accordingly.

### Transactions, Positions & Detail Drilldowns

#### TC-UI-038: Global transactions view supports multi-select filters (accounts, strategies, symbols, types, statuses) combined with date range, and drilldown navigation pre-fills exactly one filter dimension
- **Category**: Functional
- **Priority**: P1
- **Steps**: Navigate from an account/strategy/symbol detail page's "View all transactions" link
- **Expected Result**: `handleDrilldownToTransactions` resets ALL other filters to `INITIAL_FILTERS` before applying the SINGLE requested dimension (e.g., `accounts:[accountId]`) — prevents a stale filter combination from a previous browsing session silently narrowing the drilldown results in a confusing way.

#### TC-UI-039: A specific transaction ID passed via drilldown is highlighted in the resulting filtered list
- **Category**: Functional
- **Priority**: P2
- **Steps**: Drill down from a specific trade reference (e.g., clicking a trade in `DeploymentAnalysisView`'s time-series) with a `specificTxId`
- **Expected Result**: `highlightedTxId` state is set and passed to `GlobalTransactionsView`, which should visually distinguish that row (e.g., background highlight) — reset (`undefined`) automatically on any subsequent `handleNavigate` call to avoid a stale highlight persisting across unrelated navigation.

#### TC-UI-040: Transaction detail modal supports client-side-only "flag" and "notes" annotation that is NOT persisted to the backend
- **Category**: Regression (documentation of design limitation)
- **Priority**: P2
- **Steps**: Flag a transaction and add notes via `TransactionDetailModal`; refresh the page
- **Expected Result**: `handleToggleFlag`/`handleUpdateNotes` only call local `setTransactions`/`setSelectedTransaction` — there is NO corresponding `api.*` call to persist these annotations server-side. Confirm this is by design (client-side-only audit scratch-pad) and that a page refresh or `loadData()` call (which re-fetches from `api.ledger.list()`) wipes any flags/notes set — if this is unintended, it represents a data-loss UX gap; if intended, ensure the UI clearly communicates that these annotations are ephemeral/session-only.

#### TC-UI-041: Positions list for a deployment correctly requests `populate_trades=true` to show constituent fills per position
- **Category**: Functional
- **Priority**: P1
- **Steps**: View the positions tab/section within `StrategyDetailsView` (or wherever `positions.listForDeployment` is consumed)
- **Expected Result**: Confirms the request includes `populate_trades=true`; cross-reference `BackTestApp-trades-positions.md` for the backend's handling of this population flag (and its `O(N)` performance characteristics per issue #9).

### Deployment Analysis & Candlestick Charting

#### TC-UI-042: Deployment analysis view correctly renders `time_series`/`intraday_trades` and computed metrics (`profitability_factor`, `max_drawdown`, `max_drawup`) from the analysis API
- **Category**: Functional
- **Priority**: P1
- **Steps**: Open `DeploymentAnalysisView` for a deployment with a meaningful trade history; optionally apply a date/time range filter
- **Expected Result**: Chart/summary values match the raw API response fields exactly; date/time range params (`start_date`,`end_date`,`start_time`,`end_time`) are correctly appended to the querystring only when provided.

#### TC-UI-043: Live candlestick view's chart time-axis adjustment correctly compensates for the selected `timezone` (UTC vs. local/IST)
- **Category**: Functional
- **Priority**: P1
- **Steps**: Load candle data with `timezone:'UTC'` and separately with a non-UTC (e.g., default browser/IST) timezone selected
- **Expected Result**: `adjustedTime` calculation — `rawTime` unchanged for UTC mode; `rawTime - (getTimezoneOffset()*60)` for local mode — verify a known candle's UTC timestamp renders at the CORRECT visual X-axis position for both modes (e.g., 03:45 UTC tick shows as 03:45 in UTC mode and 09:15 in IST mode, matching the code comment's worked example).

#### TC-UI-044: Fetching available backtest dates gracefully falls back to a hardcoded date list if the API call fails
- **Category**: Negative (positive control, but flag hardcoded fallback staleness risk)
- **Priority**: P2
- **Steps**: Simulate `api.symbols.getBacktestDates()` failing
- **Expected Result**: Catch block sets a hardcoded fallback array (`['2026-06-24','2026-06-18','2026-06-17']`) — functional as a fail-safe, but flag that these hardcoded dates will become stale/meaningless over time and provide no real data if selected (the underlying `getCandles` call for a fabricated fallback date will simply return empty); consider whether a more honest "unable to load dates" empty-state would be preferable to silently offering fake selectable dates.

#### TC-UI-045: Selecting a symbol/date/timeframe combination with zero available candles renders an empty chart without a JS error
- **Category**: Negative
- **Priority**: P1
- **Steps**: Select a date with no market data for the chosen symbol
- **Expected Result**: `chartData.length===0` path correctly sets `lastBarRef.current=null` and skips `fitContent()` (guarded by `chartData.length > 0`) — no crash; `candlesCount` correctly shows 0, giving the user visible feedback rather than a silently blank chart with no indication of why.

### Cross-Cutting UI Resilience

#### TC-UI-046: Every list-fetch call in `loadData()` runs sequentially with a SINGLE try/catch wrapping the entire chain — one failing sub-fetch (e.g., accounts) aborts loading of everything after it in the sequence
- **Category**: Regression
- **Priority**: P1
- **Steps**: Simulate `api.accounts.list()` failing while `api.symbols.list()`/`api.deployments.list()`/etc. would otherwise succeed
- **Expected Result**: Since `loadData`'s body is one large sequential `try` block, a failure partway through (e.g., accounts) throws and skips ALL subsequent fetches (symbols, deployments, brokers, strategy definitions, ledger) for that invocation — the UI ends up with PARTIALLY stale/empty data (whatever was fetched before the failure point) with only a generic console error and no user-facing indication of which specific data domain failed to load. Recommend independent try/catch per resource (already partially done for `strategies.list()`, which correctly has its OWN inner try/catch) to prevent one flaky endpoint from blanking out unrelated sections of the dashboard.

#### TC-UI-047: The "strategy definitions" fetch already has its own isolated try/catch (positive control), unlike the rest of `loadData`
- **Category**: Functional (positive control)
- **Priority**: P2
- **Steps**: Simulate ONLY `api.strategies.list()` failing while all other `loadData` calls succeed
- **Expected Result**: Confirms this ONE specific fetch's isolated try/catch allows `loadData` to continue past it and successfully populate accounts/symbols/deployments/brokers/ledger — contrast with TC-UI-046's broader gap; useful as a template for how the other fetches SHOULD be isolated.

#### TC-UI-048: Initial full-page loading spinner only shows when `accounts.length===0` — subsequent background reloads (`loadData()` re-invocations) do not re-trigger the full-page spinner
- **Category**: Functional
- **Priority**: P2
- **Steps**: Trigger a `loadData()` refresh after the initial load (e.g., after creating a new account)
- **Expected Result**: `isLoading && accounts.length===0` guard means once ANY accounts exist, subsequent loads show data "in place" (existing UI stays visible during the background refetch) rather than replacing the whole screen with a spinner — better perceived performance, but verify no confusing flash of stale-then-fresh data for components that don't have their own loading indicators.

### Profile & Navigation Gaps

#### TC-UI-049: Profile "Save Changes" updates name/username/email in local React state only — no `PATCH /api/me` call is made
- **Category**: Regression / UX Bug
- **Priority**: P1
- **Steps**: Open Profile (`UserProfileView`), click "Edit Profile", change name/username/email, click "Save Changes"; observe network tab; refresh the page or log out and back in
- **Expected Result** (current bug): `handleSaveInfo` (`UserProfileView.tsx` ~L166–177) only calls `setName`/`setUsername`/`setEmail` and shows a success toast — there is NO `api.*` call to `PATCH /api/me` (which exists on the backend per `BackTestApp-iam-auth.md` TC-ME-002). Edited identity fields revert to server values after refresh/re-login, while the user was told "Profile identity updated successfully" — a misleading success state. Contrast with password change, session revoke, and API-key flows in the same view, which DO call the backend correctly.

#### TC-UI-050: BackTestApp CORS preflight omits `PATCH` from `Access-Control-Allow-Methods` — cross-origin PATCH calls from the UI may fail
- **Category**: Regression / Bug
- **Priority**: P1
- **Related Issue**: #50
- **Steps**: Serve BackTestUI from an origin different from BackTestApp (e.g., Vite dev server on `:5173` → API on `:3000`), trigger any PATCH operation the UI performs (`api.ts` uses PATCH for accounts, strategies, deployments, brokers); inspect browser Network tab for OPTIONS preflight response headers
- **Expected Result** (current bug): `app.js` sets `Access-Control-Allow-Methods: "GET, POST, PUT, DELETE, OPTIONS"` — **`PATCH` is missing**. Browser preflight for PATCH requests should fail with a CORS error, blocking account/strategy/deployment edits. When UI and API share the same nginx origin (production compose layout), same-origin requests bypass CORS and this bug is masked — verify both deployment modes. Cross-reference `BackTestApp-iam-auth.md` TC-AUTH-034.

#### TC-UI-051: No React Router — navigation is `activeScreen` state only; no deep links, bookmarkable URLs, or browser back/forward support
- **Category**: Functional (observational)
- **Priority**: P2
- **Steps**: Navigate to Accounts → a specific deployment detail → Profile; copy the browser URL; open in a new tab; use browser Back button
- **Expected Result**: URL never changes from the SPA root — new tab opens at the default dashboard/login screen regardless of prior navigation; browser Back/Forward does not traverse in-app views. Document as an intentional simplicity trade-off (single `App.tsx` state machine) with test implications: automated E2E must drive UI via clicks/state, not URL routing; no shareable links to specific entities.
