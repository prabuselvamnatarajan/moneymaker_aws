# BackTestApp — IAM: Auth, MFA, PATs, Sessions, RBAC — Test Case Plan

## Scope
Covers `/api/auth/*` (signup, login, logout, refresh, password change/reset, sessions, API keys, MFA) and `/api/me` (self-service profile/delete). Covers the dual authentication mechanism in `authenticate()` (JWT access tokens AND Personal Access Tokens via the same `Authorization: Bearer` header), session lifecycle, TOTP-based MFA, and the decorative RBAC subsystem.

## Prerequisites
- BackTestApp running with `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` env vars (test both set and default/unset to exercise the hardcoded fallback)
- A TOTP generator (e.g., `otplib` or Google Authenticator) capable of computing codes from a shared secret for MFA tests
- Ability to inspect issued JWTs (e.g., jwt.io) to verify claims/expiry
- A tool to fire concurrent/rapid requests for rate-limiting (or lack-thereof) checks

## Test Cases

### Signup

#### TC-AUTH-001: Signup creates user and auto-initializes predefined accounts
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/signup` with `{username, name, email, password}`
- **Expected Result**: 201 "Sign Up success!"; `initializeUserAccounts` runs (best-effort, failure doesn't block signup response).

#### TC-AUTH-002: Signup missing required fields rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Omit each of `email`/`username`/`name`/`password` in turn
- **Expected Result**: 400 "Email, username, name, and password are required".

#### TC-AUTH-003: Signup with duplicate email/username
- **Category**: Negative
- **Priority**: P1
- **Steps**: Signup twice with the same email
- **Expected Result**: Verify `authService.createUser` rejects duplicates (unique index or explicit check) with an appropriate error, not a 500.

#### TC-AUTH-004: Password stored as bcrypt hash, never returned in any response
- **Category**: Security
- **Priority**: P1
- **Steps**: Signup, then fetch the user via `/api/me` or admin endpoint
- **Expected Result**: Password field never present in any response (`select("-password")` used consistently).

### Login

#### TC-AUTH-005: Successful login without MFA returns access + refresh tokens
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/login` with correct `{email, password}` for a non-MFA user
- **Expected Result**: 200 with `accessToken`/`refreshToken`; a `Session` document created recording device/OS/browser/IP parsed from `User-Agent`/`X-Forwarded-For`.

#### TC-AUTH-006: Login with wrong password returns generic invalid-credentials error
- **Category**: Security
- **Priority**: P0
- **Steps**: `POST /api/auth/login` with correct email, wrong password
- **Expected Result**: 401 "Invalid email or password" — same generic message as unknown-email case (no user-enumeration via distinct error messages).

#### TC-AUTH-007: Login with nonexistent email returns the same generic error as wrong password
- **Category**: Security
- **Priority**: P1
- **Steps**: `POST /api/auth/login` with an email that doesn't exist
- **Expected Result**: 401 "Invalid email or password" (identical to TC-AUTH-006 — confirms no timing/message-based user enumeration at the message level; separately verify response TIMING doesn't leak existence via bcrypt-vs-no-bcrypt short-circuit).

#### TC-AUTH-008: Login for MFA-enabled user does not issue tokens directly
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/login` with correct credentials for a user with `is_mfa_enabled:true`
- **Expected Result**: 200 `{message:"MFA required", mfaRequired:true}` — no tokens issued; client must call `/api/auth/mfa/login-verify` next.

#### TC-AUTH-009: Login blocked if user has zero assigned roles
- **Category**: Negative
- **Priority**: P2
- **Steps**: Login as a user with an empty `roles` array
- **Expected Result**: 403 "User does not have an assigned role for session creation" — session creation is blocked entirely.

#### TC-AUTH-037: Deactivated user (`is_active:false`) can still log in and receive valid tokens
- **Category**: Security / Regression
- **Priority**: P0
- **Steps**: Admin sets a user's `is_active:false` via `PATCH /api/admin/users/:userId`; attempt `POST /api/auth/login` with that user's valid credentials (both MFA-disabled and MFA-enabled paths)
- **Expected Result** (current bug): `authController.login` validates email/password and MFA state but never checks `user.is_active` — login succeeds and issues access/refresh tokens (or returns `mfaRequired:true` for MFA users, who can then complete MFA and receive tokens). A deactivated user retains full API access until sessions are individually revoked. Expected secure behavior: reject login with 403 "Account deactivated" before session/token creation.

#### TC-AUTH-010: No brute-force protection on `/api/auth/login`
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #37
- **Steps**: Fire 100+ rapid `POST /api/auth/login` attempts with wrong passwords for the same account
- **Expected Result** (current bug): No `429` ever returned; no account lockout occurs; `express-rate-limit` (or equivalent) is absent from `package.json`/`app.js` — unlimited password brute-forcing is possible.

#### TC-AUTH-011: No brute-force protection on `/api/auth/mfa/login-verify`
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #37
- **Steps**: With valid email/password but unknown MFA secret, fire many rapid guesses of the 6-digit TOTP code
- **Expected Result** (current bug): No rate limiting/lockout — a 6-digit TOTP space (1,000,000 combinations, with ±30s window tolerance) is brute-forceable given enough time with zero throttling.

#### TC-AUTH-012: Session records device/OS/browser/IP correctly from headers
- **Category**: Functional
- **Priority**: P2
- **Steps**: Login with a spoofed `User-Agent` and `X-Forwarded-For`
- **Expected Result**: `parseUserAgent` output matches expected device/OS/browser; note `X-Forwarded-For` is trusted as-is with no proxy allowlist (verify if this could be spoofed by an external client when nginx doesn't strip/overwrite it).

### JWT / Secrets

#### TC-AUTH-013: JWT access/refresh secrets fall back to hardcoded defaults when env unset
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #36
- **Steps**: Start the app with `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` unset; decode an issued access token's signature using the known default `"iam-access-secret"`
- **Expected Result** (current bug): Tokens are signed with the static, publicly-known default string; anyone can forge a valid access token for an arbitrary `userId`/`sessionID` using this default secret if the operator forgets to set env vars — no startup assertion prevents this misconfiguration.

#### TC-AUTH-014: Password-reset JWT reuses the same access-token secret (and same fallback)
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #36
- **Steps**: Trigger `forgotPassword`; decode the reset token; confirm it is signed with `process.env.JWT_ACCESS_SECRET || "iam-access-secret"` — the identical secret/fallback used for session access tokens
- **Expected Result** (current bug): A leaked/forged access-token secret can also be used to mint fraudulent password-reset tokens (`purpose:"password-reset"`), since there's no dedicated secret for this purpose.

#### TC-AUTH-015: Forged access token using the default secret is accepted by `authenticate()`
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #36
- **Steps**: With default secrets in effect, craft a JWT with `{userId:<any real user's id>, email, sessionID:<any active session id>}` signed with `"iam-access-secret"`; call any protected endpoint with it
- **Expected Result** (current bug): Request is authenticated as that user — full auth bypass. (Note: still requires a session document with matching `sessionID` and `active:true` to exist per TC-AUTH-018; test both with and without an attacker-controlled valid session.)

#### TC-AUTH-016: Expired access token rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Wait past `JWT_ACCESS_EXPIRES` (default 15m) or craft an already-expired token; call a protected endpoint
- **Expected Result**: 401 "Invalid or expired access token".

#### TC-AUTH-017: `POST /api/auth/refresh-token` issues a new access token from a valid refresh token
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/refresh-token` with a valid, unexpired `refreshToken`
- **Expected Result**: New `accessToken` issued bound to the same `sessionID`; requires the session to still be active (no explicit active-session check shown in `refreshToken` controller — verify whether an ended session's refresh token is still honored, which would be a gap).

#### TC-AUTH-018: Refresh token for a revoked/ended session
- **Category**: Negative / Regression
- **Priority**: P1
- **Steps**: End a session (logout or revoke), then attempt `/api/auth/refresh-token` with that session's still-cryptographically-valid refresh token
- **Expected Result**: Verify whether `refreshToken` controller checks `session.active` — if it only calls `getSessionById` without an active filter (cross-check against `authenticate()`'s stricter `Session.findOne({_id, active:true})`), a logged-out session's refresh token might still mint new access tokens, undermining logout.

#### TC-AUTH-019: Invalid/malformed refresh token rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: Garbage string as `refreshToken`
- **Expected Result**: 401 "Invalid or expired refresh token".

### Session Management

#### TC-AUTH-020: `authenticate()` requires the session to be `active:true` in DB (JWT path)
- **Category**: Security
- **Priority**: P0
- **Steps**: Log in, then directly flip the session's `active` field to `false` in the DB (simulating revocation); reuse the still-unexpired access token
- **Expected Result**: 401 "Session has been revoked or expired" — session-DB check provides real-time revocation even though the JWT itself hasn't expired.

#### TC-AUTH-021: `GET /api/auth/sessions` lists only the caller's active sessions
- **Category**: Security
- **Priority**: P1
- **Steps**: Log in from two different "devices" (different UA); call `/api/auth/sessions`
- **Expected Result**: Both sessions listed, each with `current:true` only for the session bound to the token used; no other user's sessions leak.

#### TC-AUTH-022: `DELETE /api/auth/sessions/:sessionId` revokes a specific session
- **Category**: Functional
- **Priority**: P1
- **Steps**: Revoke a non-current session by ID
- **Expected Result**: Session marked `active:false, endedAt` set; its access/refresh tokens stop working (per TC-AUTH-020).

#### TC-AUTH-023: Cannot revoke another user's session by ID (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B attempts `DELETE /api/auth/sessions/:idBelongingToUserA`
- **Expected Result**: Query scoped by `{_id, user: req.auth.userId, active:true}` finds nothing; 404 "Session not found or already revoked".

#### TC-AUTH-024: `DELETE /api/auth/sessions/others` revokes all sessions except the current one
- **Category**: Functional
- **Priority**: P1
- **Steps**: Log in from 3 devices; call `/others` using device 1's token
- **Expected Result**: Devices 2 and 3's sessions become inactive; device 1's session remains active.

#### TC-AUTH-025: Logout ends the current session
- **Category**: Functional
- **Priority**: P1
- **Steps**: `POST /api/auth/logout`
- **Expected Result**: Session for `req.auth.sessionID` ended; subsequent requests with the same access token fail per TC-AUTH-020.

#### TC-AUTH-026: Logout without an active session context handled gracefully
- **Category**: Negative
- **Priority**: P2
- **Steps**: Call logout with a PAT-authenticated request (`sessionID: "personal-access-token"`, no real session)
- **Expected Result**: Verify behavior — `sessionService.endSession` is called with the literal string `"personal-access-token"`; confirm this doesn't throw/500 (should be a no-op or handled gracefully).

### Password Management

#### TC-AUTH-027: Change password requires correct current password
- **Category**: Security
- **Priority**: P1
- **Steps**: `POST /api/auth/change-password` with wrong `currentPassword`
- **Expected Result**: 401 "Invalid current password"; password unchanged.

#### TC-AUTH-028: Change password succeeds and re-hashes
- **Category**: Functional
- **Priority**: P1
- **Steps**: Correct `currentPassword` + valid `newPassword`
- **Expected Result**: 200; subsequent login requires the new password; old password no longer works.

#### TC-AUTH-029: Change/reset password does not revoke existing sessions
- **Category**: Negative / Regression
- **Priority**: P2
- **Steps**: Change password while logged in on two devices; check if the other device's session remains valid
- **Expected Result**: Verify whether other active sessions survive a password change — if so, this is a security gap (a compromised-account password change should ideally force re-auth everywhere).

#### TC-AUTH-030: `forgotPassword` always returns generic success regardless of email existence (no enumeration)
- **Category**: Security
- **Priority**: P1
- **Steps**: Call with a real email, then a fake email
- **Expected Result**: Identical generic response both times: "If an account exists with that email, password reset instructions have been sent."

#### TC-AUTH-031: Password reset token is never delivered in production — feature non-functional
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #44
- **Steps**: Set `NODE_ENV=production`; call `forgotPassword` for a real user; inspect logs and any outbound email/SMS
- **Expected Result** (current bug): Token is generated but only `console.log`'d when `NODE_ENV !== "production"`; in production, nothing is logged and no delivery mechanism exists (`// TODO: deliver token via email` never implemented) — users cannot actually complete password reset in production despite receiving a "success" response.

#### TC-AUTH-032: Reset token has a 15-minute expiry and single `purpose` claim
- **Category**: Functional
- **Priority**: P2
- **Steps**: Use a reset token after 16 minutes; use a valid access token (not a reset token) as the "reset token"
- **Expected Result**: Expired token → 400 "Invalid or expired reset token"; non-reset-purpose token → 400 "Invalid token purpose".

#### TC-AUTH-033: Reset password succeeds and old password stops working
- **Category**: Functional
- **Priority**: P1
- **Steps**: Complete reset flow (dev-mode token from logs) with a new password
- **Expected Result**: 200 "Password reset successfully"; login with old password fails, new password works.

### MFA — Setup

#### TC-MFA-001: MFA setup generates a TOTP secret and QR code
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/mfa/setup` (authenticated, MFA not yet enabled)
- **Expected Result**: 200 with `{otpauthUrl, qrCodeDataUrl, tempSecret}`; `user.mfa_temp_secret` persisted; `is_mfa_enabled` still `false` until verified.

#### TC-MFA-002: Setup rejected if MFA already enabled
- **Category**: Negative
- **Priority**: P1
- **Steps**: Call `/mfa/setup` again for a user with `is_mfa_enabled:true`
- **Expected Result**: 400 "MFA is already enabled for this user".

#### TC-MFA-003: Verify-setup with correct TOTP code enables MFA and issues backup codes
- **Category**: Functional
- **Priority**: P0
- **Steps**: Compute the current TOTP code from `tempSecret`; `POST /api/auth/mfa/verify-setup` with `{token}`
- **Expected Result**: `is_mfa_enabled:true`, `mfa_secret` set from `mfa_temp_secret`, `mfa_temp_secret` cleared, 8 backup codes generated.

#### TC-MFA-004: Verify-setup with incorrect/expired TOTP code rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Submit a wrong 6-digit code
- **Expected Result**: 401 "Invalid MFA token"; MFA remains disabled.

#### TC-MFA-005: Verify-setup without a prior setup call rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: Call `/mfa/verify-setup` when `mfa_temp_secret` is empty (setup never called)
- **Expected Result**: 400 "MFA setup has not been initiated".

### MFA — Login Verification

#### TC-MFA-006: `/mfa/login-verify` requires email+password+token, re-validates password
- **Category**: Security
- **Priority**: P0
- **Steps**: Call with correct email/token but wrong password
- **Expected Result**: 401 "Invalid email or password" — password is fully re-checked, not just assumed from the earlier `/login` call (stateless design; each MFA-verify call independently re-authenticates the primary factor).

#### TC-MFA-007: `/mfa/login-verify` with correct credentials + correct TOTP issues tokens and creates a session
- **Category**: Functional
- **Priority**: P0
- **Steps**: Correct email/password + valid current TOTP code
- **Expected Result**: 200 with `accessToken`/`refreshToken`; new `Session` created.

#### TC-MFA-008: `/mfa/login-verify` with correct credentials + wrong TOTP rejected
- **Category**: Negative
- **Priority**: P1
- **Steps**: Correct email/password + incorrect 6-digit code
- **Expected Result**: 401 "Invalid MFA token"; no session/tokens issued.

#### TC-MFA-009: `/mfa/login-verify` for a user without MFA enabled rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: Call the endpoint for a user with `is_mfa_enabled:false`
- **Expected Result**: 400 "MFA is not enabled for this user".

#### TC-MFA-010: TOTP time-window tolerance behavior
- **Category**: Functional
- **Priority**: P2
- **Steps**: Submit a code from 30s ago (previous window) and one from 30s in the future
- **Expected Result**: Document `otplib` authenticator's default window tolerance; confirm expected accept/reject behavior at the boundary.

### MFA — Disable

#### TC-MFA-011: MFA disable requires only a valid session — no re-verification
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #38
- **Steps**: With a valid access token (only `authenticate` middleware applied, no additional check), `POST /api/auth/mfa/disable`
- **Expected Result** (current bug): MFA is disabled immediately — `mfaController.disable` calls `mfaService.disableMfa(user)` directly with no requirement for the current TOTP code or account password in the request body. A stolen/leaked session token alone is sufficient to permanently strip MFA protection from the account.

#### TC-MFA-012: MFA disable clears secret and backup codes
- **Category**: Functional
- **Priority**: P1
- **Steps**: Disable MFA; inspect user document
- **Expected Result**: `is_mfa_enabled:false`, `mfa_secret:""`, `mfa_temp_secret:""`, `backup_codes:[]`.

#### TC-MFA-013: After disable, subsequent logins skip MFA entirely
- **Category**: Regression
- **Priority**: P1
- **Steps**: Disable MFA, then log in with just email/password
- **Expected Result**: Direct token issuance (no `mfaRequired` gate) — confirms full removal of the second factor.

### Personal Access Tokens (PATs)

#### TC-PAT-001: Create API key returns the raw token exactly once
- **Category**: Functional
- **Priority**: P0
- **Steps**: `POST /api/auth/api-keys` with `{name:"CI Token"}`
- **Expected Result**: 201 with full `token` (`ct_live_<32 hex chars>`) in the response body; subsequent `GET /api/auth/api-keys` never returns the full token again, only `tokenPrefix`.

#### TC-PAT-002: PAT authenticates like a JWT via the same `Authorization: Bearer` header
- **Category**: Functional
- **Priority**: P0
- **Steps**: Call any protected endpoint with `Authorization: Bearer ct_live_<token>`
- **Expected Result**: `authenticate()` detects the `ct_live_`/`ct_test_` prefix, looks up `PersonalAccessToken.findOne({token, active:true})`, and authenticates as the owning user with `sessionID:"personal-access-token"`.

#### TC-PAT-003: Revoked (inactive) PAT rejected
- **Category**: Security
- **Priority**: P1
- **Steps**: Revoke a PAT via `DELETE /api/auth/api-keys/:keyId`; retry a request using that token
- **Expected Result**: 401 "Invalid or revoked personal access token".

#### TC-PAT-004: Cannot revoke another user's PAT (IDOR)
- **Category**: Security
- **Priority**: P0
- **Steps**: User B attempts `DELETE /api/auth/api-keys/:keyIdBelongingToUserA`
- **Expected Result**: Scoped query finds nothing; 404 "API key not found or already revoked".

#### TC-PAT-005: PATs stored and matched in plaintext — no hashing at rest
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #39
- **Steps**: Inspect the `PersonalAccessToken` collection directly in MongoDB after creating a key
- **Expected Result** (current bug): The full bearer token string is stored as plaintext in the `token` field and matched via a direct `findOne({token})` equality query — a database backup leak, injection, or insider with read access yields immediately usable, long-lived API credentials. (Contrast with best practice: store only a SHA-256 hash and compare hashes.)

#### TC-PAT-006: PAT `lastUsedAt` updates asynchronously without blocking the request
- **Category**: Functional
- **Priority**: P2
- **Steps**: Make an authenticated request with a PAT; check `lastUsedAt` afterward
- **Expected Result**: Field updates (fire-and-forget `.save().catch(...)` — verify a save failure here is only logged, never surfaces as a request error).

#### TC-PAT-007: PAT never expires unless explicitly revoked
- **Category**: Negative / Regression
- **Priority**: P2
- **Steps**: Inspect the schema for any `expiresAt`/TTL field
- **Expected Result**: No expiration mechanism exists — PATs are valid indefinitely until manually revoked, increasing blast radius of a leak.

#### TC-PAT-008: Missing `name` on API key creation rejected
- **Category**: Negative
- **Priority**: P2
- **Steps**: `POST /api/auth/api-keys` with no `name`
- **Expected Result**: 400 "API key name is required".

### Self-Service Profile (`/api/me`)

#### TC-ME-001: `GET /api/me` returns own profile without password
- **Category**: Functional
- **Priority**: P1
- **Steps**: `GET /api/me`
- **Expected Result**: 200 with own user doc (roles populated), no password field.

#### TC-ME-002: `PATCH /api/me` updates name/username/email with uniqueness checks
- **Category**: Functional
- **Priority**: P1
- **Steps**: Update `email` to one already used by another user
- **Expected Result**: 409 "Email is already taken"; same for `username`.

#### TC-ME-003: `DELETE /api/me` requires no re-authentication (password/MFA) whatsoever
- **Category**: Security / Regression
- **Priority**: P0
- **Related Issue**: #46
- **Steps**: With only a valid (possibly stolen) access token, `DELETE /api/me`
- **Expected Result** (current bug): `deleteMeController` immediately calls `User.findByIdAndDelete(userId)` with zero password/MFA confirmation — a hijacked session token is sufficient to permanently delete the account in a single request.

#### TC-ME-004: Self-delete performs no cascade cleanup of related data
- **Category**: Regression
- **Priority**: P0
- **Related Issue**: #46
- **Steps**: Delete self after creating Accounts/Deployments/Trades/Ledgers/Sessions/PATs; inspect DB afterward
- **Expected Result** (current bug): Only the `User` document is removed; all Accounts, Deployments, Trades, Ledgers, Sessions, and PersonalAccessTokens remain in the database as permanent orphans referencing a nonexistent `user_id` — no cascade delete or soft-delete, and no session/PAT revocation occurs (a PAT issued before deletion may continue to "authenticate" if `authService.findUserById` behavior with a deleted user is not explicitly guarded — verify this edge case directly as TC-ME-005).

#### TC-ME-005: PAT/session usable after account self-deletion?
- **Category**: Security / Regression
- **Priority**: P1
- **Steps**: Delete self via `/api/me`; immediately retry a request using the previously-valid access token, then using a previously-valid PAT
- **Expected Result**: Verify both `authenticate()` paths call `findUserById`/lookup on the (now-deleted) user — expect a 401 "user not found" in both cases, but confirm no crash and no stale-permission leakage in the brief window.

### RBAC (Decorative Subsystem)

#### TC-RBAC-001: `authorize()` middleware is never imported/used by any route
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #41
- **Steps**: Search all route files for `authorize(` usage
- **Expected Result** (confirmed gap): Zero matches — the full `Role`/`Permission` model and `authorize([...])` middleware in `iam/middlewares/authorizationMiddleware.js` exist but are wired to nothing; all real authorization is done ad-hoc via `isAdmin`/manual checks in controllers.

#### TC-RBAC-002: Assigning fine-grained Permissions to a Role has no observable effect on API access
- **Category**: Security
- **Priority**: P2
- **Steps**: Create a Role with a restrictive Permission set, assign it to a test user, and attempt actions that should be denied per that permission model
- **Expected Result**: Actions succeed anyway (limited only by whatever ad-hoc `isAdmin`/ownership checks exist) — confirms the Permission model has zero enforcement, potentially giving false confidence to anyone configuring roles/permissions expecting them to be enforced.

### CORS

#### TC-AUTH-034: Wide-open CORS allows any origin on auth/money endpoints; `PATCH` method omitted from preflight allow-list
- **Category**: Security / Regression
- **Priority**: P1
- **Related Issue**: #50
- **Steps**: Send a request to `/api/auth/login` with an arbitrary `Origin` header (e.g., `https://evil.example.com`); inspect `Access-Control-Allow-Origin` in the response. Separately send an OPTIONS preflight for a PATCH request to `/api/accounts/:id` from a foreign origin.
- **Expected Result** (current bug): `Access-Control-Allow-Origin: *` is returned for every route including auth and money endpoints — no origin allow-list. Additionally, `Access-Control-Allow-Methods` lists only `GET, POST, PUT, DELETE, OPTIONS` — **`PATCH` is missing** (`app.js` L23), so cross-origin PATCH requests fail browser preflight even though the UI relies on PATCH extensively. Same-origin nginx deployment masks the PATCH gap; cross-reference `BackTestUI.md` TC-UI-050.

### General Auth Hardening

#### TC-AUTH-035: No security headers (helmet) applied
- **Category**: Security / Regression
- **Priority**: P2
- **Related Issue**: #23
- **Steps**: Inspect response headers of any BackTestApp endpoint
- **Expected Result**: No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc. — `helmet()` is not used.

#### TC-AUTH-036: Malformed JSON body may leak stack trace in error response
- **Category**: Security / Regression
- **Priority**: P2
- **Related Issue**: #24
- **Steps**: Send a request with invalid JSON body and observe the error response; check whether `NODE_ENV=production` is set in the Dockerfile/deployment
- **Expected Result** (current gap): If `NODE_ENV` isn't `production` and no custom 4-arg error-handling middleware exists, Express's default handler may include a stack trace in the response body — verify actual production configuration.
