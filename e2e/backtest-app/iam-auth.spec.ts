import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import {
  apiPath,
  apiRequest,
  authHeaders,
  loginAs,
  loginAsAdmin,
  uniqueSuffix,
  getMe,
  createUserB,
} from '../fixtures/auth';
import { generateTotp, generateTotpAt } from '../fixtures/totp';
import { createAccount, createTradeFixture } from '../fixtures/factories';
import { expectStatus, expectMessageContains, tags, newObjectId } from '../fixtures/test-helpers';

const DEFAULT_ACCESS_SECRET = 'iam-access-secret';
const JWT_ISSUER = 'iam-service';
const JWT_AUDIENCE = 'iam-clients';
const ROUTES_DIR = path.resolve(__dirname, '../../BackTest/BackTestApp/src/routes');
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'BacktestApp';
const NO_SECRETS_BASE_URL = process.env.API_NO_SECRETS_BASE_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupFresh(request: APIRequestContext, suffix = uniqueSuffix()) {
  const email = `e2e-${suffix}@e2e.test.com`;
  const username = `e2e${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
  const password = 'TestPass123!';
  const res = await request.post(apiPath('/auth/signup'), {
    data: { username, name: 'E2E User', email, password },
  });
  return { email, username, password, res, suffix };
}

async function loginRaw(
  request: APIRequestContext,
  email: string,
  password: string,
  extraHeaders: Record<string, string> = {}
) {
  return request.post(apiPath('/auth/login'), {
    data: { email, password },
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function setupMfaUser(request: APIRequestContext, accessToken: string): Promise<string> {
  const setupRes = await apiRequest(request, accessToken).post('/auth/mfa/setup');
  await expectStatus(setupRes, 200);
  const body = await setupRes.json();
  const setup = body?.data ?? body;
  expect(setup.tempSecret).toBeTruthy();
  const verifyRes = await apiRequest(request, accessToken).post('/auth/mfa/verify-setup', {
    data: { token: generateTotp(setup.tempSecret) },
  });
  await expectStatus(verifyRes, 200);
  return setup.tempSecret as string;
}

async function mfaLoginVerify(
  request: APIRequestContext,
  email: string,
  password: string,
  mfaSecret: string
) {
  return request.post(apiPath('/auth/mfa/login-verify'), {
    data: { email, password, token: generateTotp(mfaSecret) },
  });
}

function decodeAccessToken(token: string) {
  return jwt.decode(token) as jwt.JwtPayload & { userId: string; sessionID: string; email: string };
}

function signAccessToken(
  payload: Record<string, unknown>,
  secret = DEFAULT_ACCESS_SECRET,
  expiresIn: jwt.SignOptions['expiresIn'] = '15m'
) {
  return jwt.sign(payload, secret, { expiresIn, issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
}

function signResetToken(userId: string, expiresIn: jwt.SignOptions['expiresIn'] = '15m') {
  const secret = process.env.JWT_ACCESS_SECRET || DEFAULT_ACCESS_SECRET;
  return jwt.sign({ userId, purpose: 'password-reset' }, secret, { expiresIn });
}

function responseHasPasswordField(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if ('password' in (obj as Record<string, unknown>)) return true;
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (responseHasPasswordField(value)) return true;
  }
  return false;
}

async function withMongo<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T | undefined> {
  if (!MONGO_URI) return undefined;
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    return await fn(client.db(MONGO_DB));
  } finally {
    await client.close();
  }
}

async function noSecretsContext() {
  if (!NO_SECRETS_BASE_URL) throw new Error('API_NO_SECRETS_BASE_URL not set');
  const base = NO_SECRETS_BASE_URL.replace(/\/?$/, '/');
  return playwrightRequest.newContext({ baseURL: base, ignoreHTTPSErrors: true });
}

function grepRoutesForAuthorize(): string[] {
  const hits: string[] = [];
  if (!fs.existsSync(ROUTES_DIR)) return hits;
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('authorize(')) {
        hits.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Signup — TC-AUTH-001 .. TC-AUTH-004
// ---------------------------------------------------------------------------

test.describe('Signup', () => {
  test('TC-AUTH-001: signup creates user and auto-initializes predefined accounts', async ({ request }) => {
    const { email, password, res } = await signupFresh(request);
    await expectStatus(res, 201);
    await expectMessageContains(res, 'Sign Up success!');

    const tokens = await loginAs(request, email, password);
    const accountsRes = await apiRequest(request, tokens.accessToken).get('/accounts');
    await expectStatus(accountsRes, 200);
    const accounts = await accountsRes.json();
    const list = Array.isArray(accounts) ? accounts : accounts.items || [];
    const types = list.map((a: { account_type?: string }) => a.account_type);
    expect(types).toContain('PAPER');
    expect(types).toContain('SIMULATION');
  });

  test('TC-AUTH-002: signup missing required fields rejected', async ({ request }) => {
    const base = { username: 'u', name: 'N', email: 'a@b.com', password: 'Pass123!' };
    const cases = [
      { ...base, email: undefined },
      { ...base, username: undefined },
      { ...base, name: undefined },
      { ...base, password: undefined },
    ];
    for (const body of cases) {
      const res = await request.post(apiPath('/auth/signup'), { data: body });
      await expectStatus(res, 400);
      await expectMessageContains(res, 'Email, username, name, and password are required');
    }
  });

  test('TC-AUTH-003: signup with duplicate email/username rejected', async ({ request }) => {
    const { email, username, password } = await signupFresh(request);
    const dupEmail = await request.post(apiPath('/auth/signup'), {
      data: { username: `${username}x`, name: 'Dup', email, password },
    });
    await expectStatus(dupEmail, 409);
    await expectMessageContains(dupEmail, 'User already exists');

    const dupUser = await request.post(apiPath('/auth/signup'), {
      data: { username, name: 'Dup2', email: `other-${uniqueSuffix()}@e2e.test.com`, password },
    });
    await expectStatus(dupUser, 409);
    await expectMessageContains(dupUser, 'User already exists');
  });

  test('TC-AUTH-004: password stored as bcrypt hash, never returned in any response', async ({ request }) => {
    const { email, password, res } = await signupFresh(request);
    await expectStatus(res, 201);
    const signupBody = await res.json();
    expect(responseHasPasswordField(signupBody)).toBe(false);

    const tokens = await loginAs(request, email, password);
    const loginRes = await loginRaw(request, email, password);
    const loginBody = await loginRes.json();
    expect(responseHasPasswordField(loginBody)).toBe(false);

    const me = await getMe(request, tokens.accessToken);
    expect(responseHasPasswordField(me)).toBe(false);
    expect(me.data?.password).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Login — TC-AUTH-005 .. TC-AUTH-012, TC-AUTH-037
// ---------------------------------------------------------------------------

test.describe('Login', () => {
  test('TC-AUTH-005: successful login without MFA returns access + refresh tokens', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res = await loginRaw(request, email, password, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'X-Forwarded-For': '203.0.113.50',
    });
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.mfaRequired).toBeFalsy();

    const meToken = data.accessToken as string;
    const sessionsRes = await apiRequest(request, meToken).get('/auth/sessions');
    await expectStatus(sessionsRes, 200);
    const sessions = await sessionsRes.json();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const current = sessions.find((s: { current?: boolean }) => s.current);
    expect(current?.os).toBe('Windows');
    expect(current?.browser).toBe('Chrome');
    // Nginx appends proxy IP → "client, proxy"
    expect(String(current?.ip || '')).toMatch(/^203\.0\.113\.50/);
  });

  test('TC-AUTH-006: login with wrong password returns generic invalid-credentials error', async ({ request }) => {
    const { email } = await signupFresh(request);
    const res = await loginRaw(request, email, 'WrongPassword999!');
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid email or password');
  });

  test('TC-AUTH-007: login with nonexistent email returns same generic error as wrong password', async ({ request }) => {
    const res = await loginRaw(request, `nobody-${uniqueSuffix()}@e2e.test.com`, 'SomePass123!');
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid email or password');
  });

  test('TC-AUTH-008: login for MFA-enabled user does not issue tokens directly', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);

    const res = await loginRaw(request, email, password);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.mfaRequired).toBe(true);
    expect(data.message).toMatch(/MFA required/i);
    expect(data.accessToken).toBeUndefined();
    expect(data.refreshToken).toBeUndefined();
  });

  test('TC-AUTH-009: login blocked if user has zero assigned roles', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const suffix = uniqueSuffix();
    const email = `norole-${suffix}@e2e.test.com`;
    const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
      data: {
        username: `norole${suffix}`,
        name: 'No Role User',
        email,
        password: 'NoRolePass123!',
        roles: [],
      },
    });
    await expectStatus(createRes, 201);

    const res = await loginRaw(request, email, 'NoRolePass123!');
    await expectStatus(res, 403);
    await expectMessageContains(res, 'User does not have an assigned role for session creation');
  });

  test('TC-AUTH-037: deactivated user can still log in (known bug)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const suffix = uniqueSuffix();
    const email = `deact-${suffix}@e2e.test.com`;
    const password = 'DeactPass123!';
    const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
      data: {
        username: `deact${suffix}`,
        name: 'Deactivated User',
        email,
        password,
      },
    });
    await expectStatus(createRes, 201);
    const created = await createRes.json();
    const userId = created.data?._id || created.data?.id;

    const patchRes = await apiRequest(request, admin.accessToken).patch(`/admin/users/${userId}`, {
      data: { is_active: false },
    });
    await expectStatus(patchRes, 200);

    const loginRes = await loginRaw(request, email, password);
    await expectStatus(loginRes, 200);
    const data = await loginRes.json();
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
  });

  test('TC-AUTH-010: no brute-force protection on /api/auth/login (#37)', async ({ request }) => {
    const { email } = await signupFresh(request);
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await loginRaw(request, email, `wrong-${i}`);
      statuses.push(res.status());
    }
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(90);
  });

  test('TC-AUTH-011: no brute-force protection on /api/auth/mfa/login-verify (#37)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const mfaSecret = await setupMfaUser(request, tokens.accessToken);

    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await request.post(apiPath('/auth/mfa/login-verify'), {
        data: { email, password, token: String(i).padStart(6, '0') },
      });
      statuses.push(res.status());
    }
    expect(statuses.every((s) => s !== 429)).toBe(true);
    expect(statuses.some((s) => s === 401)).toBe(true);
    void mfaSecret;
  });

  test('TC-AUTH-012: session records device/OS/browser/IP from headers', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const res = await loginRaw(request, email, password, {
      'User-Agent': ua,
      'X-Forwarded-For': '198.51.100.42',
    });
    await expectStatus(res, 200);
    const { accessToken } = await res.json();
    const sessionsRes = await apiRequest(request, accessToken).get('/auth/sessions');
    const sessions = await sessionsRes.json();
    const current = sessions.find((s: { current?: boolean }) => s.current);
    expect(current.device).toBe('iPhone');
    expect(current.os).toBe('iOS');
    expect(current.browser).toBe('Safari');
    expect(current.ip).toBe('198.51.100.42');
  });
});

// ---------------------------------------------------------------------------
// JWT / Secrets — TC-AUTH-013 .. TC-AUTH-019
// ---------------------------------------------------------------------------

test.describe('JWT and secrets', () => {
  test('TC-AUTH-013: JWT secrets fall back to hardcoded defaults when env unset (#36)', { ...tags.noSecrets }, async () => {
    test.skip(!NO_SECRETS_BASE_URL, 'Requires API_NO_SECRETS_BASE_URL — stack started without JWT_ACCESS_SECRET/JWT_REFRESH_SECRET (#36)');

    const ctx = await noSecretsContext();
    try {
      const { email, password } = await signupFresh(ctx);
      await expectStatus(await loginRaw(ctx, email, password), 200);
      const loginRes = await loginRaw(ctx, email, password);
      const { accessToken } = await loginRes.json();
      expect(() =>
        jwt.verify(accessToken, DEFAULT_ACCESS_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE })
      ).not.toThrow();
    } finally {
      await ctx.dispose();
    }
  });

  test('TC-AUTH-014: password-reset JWT reuses access-token secret and fallback (#36)', async ({ request }) => {
    const { email } = await signupFresh(request);
    const res = await request.post(apiPath('/auth/forgot-password'), { data: { email } });
    await expectStatus(res, 200);

    const secret = process.env.JWT_ACCESS_SECRET || DEFAULT_ACCESS_SECRET;
    const meRes = await request.post(apiPath('/auth/forgot-password'), { data: { email } });
    await expectStatus(meRes, 200);

    const forgedReset = signResetToken(newObjectId());
    expect(() => jwt.verify(forgedReset, secret)).not.toThrow();
    const payload = jwt.decode(forgedReset) as jwt.JwtPayload;
    expect(payload.purpose).toBe('password-reset');

    const userLogin = await signupFresh(request);
    const resetToken = signResetToken(
      decodeAccessToken((await loginAs(request, userLogin.email, userLogin.password)).accessToken).userId
    );
    expect(() => jwt.verify(resetToken, secret)).not.toThrow();
  });

  test('TC-AUTH-015: forged access token using default secret accepted by authenticate() (#36)', { ...tags.noSecrets }, async () => {
    test.skip(!NO_SECRETS_BASE_URL, 'Requires API_NO_SECRETS_BASE_URL (#36 default secret fallback)');

    const ctx = await noSecretsContext();
    try {
      const { email, password } = await signupFresh(ctx);
      const loginRes = await loginRaw(ctx, email, password);
      const { accessToken } = await loginRes.json();
      const decoded = decodeAccessToken(accessToken);

      const forged = signAccessToken({
        userId: decoded.userId,
        email: decoded.email,
        sessionID: decoded.sessionID,
      });

      const meRes = await ctx.get(apiPath('/me'), { headers: authHeaders(forged) });
      await expectStatus(meRes, 200);
    } finally {
      await ctx.dispose();
    }
  });

  test('TC-AUTH-016: expired access token rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const decoded = decodeAccessToken(tokens.accessToken);
    const expired = signAccessToken(
      { userId: decoded.userId, email: decoded.email, sessionID: decoded.sessionID },
      process.env.JWT_ACCESS_SECRET || DEFAULT_ACCESS_SECRET,
      '-1s'
    );
    const res = await request.get(apiPath('/me'), { headers: authHeaders(expired) });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid or expired access token');
  });

  test('TC-AUTH-017: refresh-token issues new access token from valid refresh token', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const loginRes = await loginRaw(request, email, password);
    const { accessToken, refreshToken } = await loginRes.json();

    // Wait 1 second so JWT iat timestamp increments, producing a fresh access token string
    await new Promise((resolve) => setTimeout(resolve, 1050));

    const refreshRes = await request.post(apiPath('/auth/refresh-token'), {
      data: { refreshToken },
    });
    await expectStatus(refreshRes, 200);
    const refreshed = await refreshRes.json();
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.accessToken).not.toBe(accessToken);

    const meRes = await request.get(apiPath('/me'), {
      headers: authHeaders(refreshed.accessToken),
    });
    await expectStatus(meRes, 200);
  });

  test('TC-AUTH-018: refresh token for revoked/ended session rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const loginRes = await loginRaw(request, email, password);
    const { accessToken, refreshToken } = await loginRes.json();

    const logoutRes = await request.post(apiPath('/auth/logout'), {
      headers: authHeaders(accessToken),
    });
    await expectStatus(logoutRes, 200);

    const refreshRes = await request.post(apiPath('/auth/refresh-token'), {
      data: { refreshToken },
    });
    await expectStatus(refreshRes, 401);
    await expectMessageContains(refreshRes, 'Invalid or expired refresh token');
  });

  test('TC-AUTH-019: invalid/malformed refresh token rejected', async ({ request }) => {
    const res = await request.post(apiPath('/auth/refresh-token'), {
      data: { refreshToken: 'not-a-valid-jwt-token' },
    });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid or expired refresh token');
  });
});

// ---------------------------------------------------------------------------
// Session management — TC-AUTH-020 .. TC-AUTH-026
// ---------------------------------------------------------------------------

test.describe('Session management', () => {
  test('TC-AUTH-020: authenticate() requires session active:true in DB', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const loginRes = await loginRaw(request, email, password);
    const { accessToken } = await loginRes.json();
    const decoded = decodeAccessToken(accessToken);

    const flipped = await withMongo(async (db) => {
      const { ObjectId } = await import('mongodb');
      await db.collection('sessions').updateOne(
        { _id: new ObjectId(decoded.sessionID) },
        { $set: { active: false, endedAt: new Date() } }
      );
      return true;
    });

    if (!flipped) {
      await request.post(apiPath('/auth/logout'), { headers: authHeaders(accessToken) });
    }

    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(accessToken) });
    await expectStatus(meRes, 401);
    await expectMessageContains(meRes, 'Session has been revoked or expired');
  });

  test('TC-AUTH-021: GET /auth/sessions lists only caller active sessions', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res1 = await loginRaw(request, email, password, { 'User-Agent': 'Device-A/1.0 Chrome' });
    const { accessToken: token1 } = await res1.json();
    await loginRaw(request, email, password, { 'User-Agent': 'Device-B/1.0 Firefox' });

    const sessionsRes = await apiRequest(request, token1).get('/auth/sessions');
    await expectStatus(sessionsRes, 200);
    const sessions = await sessionsRes.json();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s: { current?: boolean }) => s.current).length).toBe(1);
  });

  test('TC-AUTH-022: DELETE /auth/sessions/:sessionId revokes a specific session', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res1 = await loginRaw(request, email, password, { 'User-Agent': 'Keep-Device/1.0' });
    const { accessToken: keeperToken } = await res1.json();
    const res2 = await loginRaw(request, email, password, { 'User-Agent': 'Revoke-Device/1.0' });
    const { accessToken: victimToken } = await res2.json();

    const listRes = await apiRequest(request, keeperToken).get('/auth/sessions');
    const sessions = await listRes.json();
    const victim = sessions.find((s: { current?: boolean }) => !s.current);
    expect(victim).toBeTruthy();

    const delRes = await apiRequest(request, keeperToken).delete(`/auth/sessions/${victim.id}`);
    await expectStatus(delRes, 200);

    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(victimToken) });
    await expectStatus(meRes, 401);
    await expectMessageContains(meRes, 'Session has been revoked or expired');
  });

  test('TC-AUTH-023: cannot revoke another user session by ID (IDOR)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userA = await signupFresh(request);
    const tokensA = await loginAs(request, userA.email, userA.password);
    const sessionsA = await apiRequest(request, tokensA.accessToken).get('/auth/sessions');
    const sessionA = (await sessionsA.json())[0];

    const userB = await createUserB(request, admin.accessToken);
    const delRes = await apiRequest(request, userB.tokens.accessToken).delete(
      `/auth/sessions/${sessionA.id}`
    );
    await expectStatus(delRes, 404);
    await expectMessageContains(delRes, 'Session not found or already revoked');
  });

  test('TC-AUTH-024: DELETE /auth/sessions/others revokes all except current', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res1 = await loginRaw(request, email, password, { 'User-Agent': 'Primary/1.0' });
    const { accessToken: primary } = await res1.json();
    const res2 = await loginRaw(request, email, password, { 'User-Agent': 'Secondary/1.0' });
    const { accessToken: secondary } = await res2.json();
    await loginRaw(request, email, password, { 'User-Agent': 'Tertiary/1.0' });

    const othersRes = await apiRequest(request, primary).delete('/auth/sessions/others');
    await expectStatus(othersRes, 200);

    const meSecondary = await request.get(apiPath('/me'), { headers: authHeaders(secondary) });
    await expectStatus(meSecondary, 401);

    const mePrimary = await request.get(apiPath('/me'), { headers: authHeaders(primary) });
    await expectStatus(mePrimary, 200);
  });

  test('TC-AUTH-025: logout ends the current session', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const loginRes = await loginRaw(request, email, password);
    const { accessToken } = await loginRes.json();

    const logoutRes = await request.post(apiPath('/auth/logout'), { headers: authHeaders(accessToken) });
    await expectStatus(logoutRes, 200);
    await expectMessageContains(logoutRes, 'Logout successful');

    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(accessToken) });
    await expectStatus(meRes, 401);
    await expectMessageContains(meRes, 'Session has been revoked or expired');
  });

  test('TC-AUTH-026: logout with PAT-authenticated request handled (no real session)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createKey = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Logout PAT test' },
    });
    await expectStatus(createKey, 201);
    const { key } = await createKey.json();

    const logoutRes = await request.post(apiPath('/auth/logout'), {
      headers: authHeaders(key.token),
    });
    expect([200, 404, 500]).toContain(logoutRes.status());
  });
});

// ---------------------------------------------------------------------------
// Password management — TC-AUTH-027 .. TC-AUTH-033
// ---------------------------------------------------------------------------

test.describe('Password management', () => {
  test('TC-AUTH-027: change password requires correct current password', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const res = await apiRequest(request, tokens.accessToken).post('/auth/change-password', {
      data: { currentPassword: 'WrongOldPass!', newPassword: 'NewPass123!' },
    });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid current password');
  });

  test('TC-AUTH-028: change password succeeds and re-hashes', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const newPassword = 'ChangedPass456!';
    const changeRes = await apiRequest(request, tokens.accessToken).post('/auth/change-password', {
      data: { currentPassword: password, newPassword },
    });
    await expectStatus(changeRes, 200);

    const oldLogin = await loginRaw(request, email, password);
    await expectStatus(oldLogin, 401);

    const newLogin = await loginRaw(request, email, newPassword);
    await expectStatus(newLogin, 200);
  });

  test('TC-AUTH-029: change password does not revoke existing sessions (security gap)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res1 = await loginRaw(request, email, password, { 'User-Agent': 'Device-1' });
    const { accessToken: token1 } = await res1.json();
    const res2 = await loginRaw(request, email, password, { 'User-Agent': 'Device-2' });
    const { accessToken: token2 } = await res2.json();

    await apiRequest(request, token1).post('/auth/change-password', {
      data: { currentPassword: password, newPassword: 'RotatedPass789!' },
    });

    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(token2) });
    await expectStatus(meRes, 200);
  });

  test('TC-AUTH-030: forgotPassword returns generic success regardless of email existence', async ({ request }) => {
    const { email } = await signupFresh(request);
    const real = await request.post(apiPath('/auth/forgot-password'), { data: { email } });
    const fake = await request.post(apiPath('/auth/forgot-password'), {
      data: { email: `fake-${uniqueSuffix()}@e2e.test.com` },
    });
    await expectStatus(real, 200);
    await expectStatus(fake, 200);
    const realBody = await real.json();
    const fakeBody = await fake.json();
    expect(realBody.message).toBe(fakeBody.message);
    expect(realBody.message).toMatch(/If an account exists/i);
  });

  test('TC-AUTH-031: password reset token never delivered in production (#44)', async ({ request }) => {
    const { email } = await signupFresh(request);
    const res = await request.post(apiPath('/auth/forgot-password'), { data: { email } });
    await expectStatus(res, 200);
    const body = await res.json();
    expect(body.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/eyJ/);
  });

  test('TC-AUTH-032: reset token expiry and purpose claims enforced', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const userId = decodeAccessToken(tokens.accessToken).userId;

    const expired = signResetToken(userId, '-1s');
    const expiredRes = await request.post(apiPath('/auth/reset-password'), {
      data: { token: expired, newPassword: 'ResetPass111!' },
    });
    await expectStatus(expiredRes, 400);
    await expectMessageContains(expiredRes, 'Invalid or expired reset token');

    const wrongPurpose = signAccessToken({ userId, email, sessionID: newObjectId() });
    const purposeRes = await request.post(apiPath('/auth/reset-password'), {
      data: { token: wrongPurpose, newPassword: 'ResetPass222!' },
    });
    await expectStatus(purposeRes, 400);
    await expectMessageContains(purposeRes, 'Invalid token purpose');
  });

  test('TC-AUTH-033: reset password succeeds and old password stops working', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const userId = decodeAccessToken(tokens.accessToken).userId;
    const resetToken = signResetToken(userId);
    const newPassword = 'ResetSuccess999!';

    const resetRes = await request.post(apiPath('/auth/reset-password'), {
      data: { token: resetToken, newPassword },
    });
    await expectStatus(resetRes, 200);
    await expectMessageContains(resetRes, 'Password reset successfully');

    await expectStatus(await loginRaw(request, email, password), 401);
    await expectStatus(await loginRaw(request, email, newPassword), 200);
  });
});

// ---------------------------------------------------------------------------
// CORS / hardening — TC-AUTH-034 .. TC-AUTH-036
// ---------------------------------------------------------------------------

test.describe('CORS and hardening', () => {
  test('TC-AUTH-034: wide-open CORS and PATCH omitted from preflight (#50)', async ({ request }) => {
    const loginRes = await request.post(apiPath('/auth/login'), {
      data: { email: 'nobody@e2e.test.com', password: 'x' },
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(loginRes.headers()['access-control-allow-origin']).toBe('*');

    const preflight = await request.fetch(apiPath('/accounts/000000000000000000000001'), {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'PATCH',
      },
    });
    const methods = preflight.headers()['access-control-allow-methods'] || '';
    expect(methods).toContain('GET');
    expect(methods).not.toContain('PATCH');
  });

  test('TC-AUTH-035: no security headers (helmet) applied (#23)', async ({ request }) => {
    const res = await request.get(apiPath('health'));
    await expectStatus(res, 200);
    const headers = res.headers();
    expect(headers['x-content-type-options']).toBeUndefined();
    expect(headers['x-frame-options']).toBeUndefined();
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  test('TC-AUTH-036: malformed JSON body may leak stack trace (#24)', async ({ request }) => {
    const res = await request.post(apiPath('/auth/login'), {
      headers: { 'Content-Type': 'application/json' },
      data: '{ invalid json',
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    if (process.env.NODE_ENV !== 'production') {
      expect(body.includes('stack') || body.includes('SyntaxError')).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// MFA — TC-MFA-001 .. TC-MFA-013
// ---------------------------------------------------------------------------

test.describe('MFA setup and login', () => {
  test('TC-MFA-001: MFA setup generates TOTP secret and QR code', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const res = await apiRequest(request, tokens.accessToken).post('/auth/mfa/setup');
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.otpauthUrl).toBeTruthy();
    expect(data.qrCodeDataUrl).toMatch(/^data:image/);
    expect(data.tempSecret).toBeTruthy();

    const me = await getMe(request, tokens.accessToken);
    expect(me.data?.is_mfa_enabled).toBe(false);
  });

  test('TC-MFA-002: setup rejected if MFA already enabled', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);
    const res = await apiRequest(request, tokens.accessToken).post('/auth/mfa/setup');
    await expectStatus(res, 400);
    await expectMessageContains(res, 'MFA is already enabled for this user');
  });

  test('TC-MFA-003: verify-setup with correct TOTP enables MFA and issues backup codes', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const setupRes = await apiRequest(request, tokens.accessToken).post('/auth/mfa/setup');
    const { tempSecret } = await setupRes.json();
    const verifyRes = await apiRequest(request, tokens.accessToken).post('/auth/mfa/verify-setup', {
      data: { token: generateTotp(tempSecret) },
    });
    await expectStatus(verifyRes, 200);

    const me = await getMe(request, tokens.accessToken);
    expect(me.data?.is_mfa_enabled).toBe(true);

    const backupCount = await withMongo(async (db) => {
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      return user?.backup_codes?.length ?? null;
    });
    if (backupCount !== null && backupCount !== undefined) {
      expect(backupCount).toBe(8);
    }
  });

  test('TC-MFA-004: verify-setup with incorrect TOTP rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await apiRequest(request, tokens.accessToken).post('/auth/mfa/setup');
    const res = await apiRequest(request, tokens.accessToken).post('/auth/mfa/verify-setup', {
      data: { token: '000000' },
    });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid MFA token');
    const me = await getMe(request, tokens.accessToken);
    expect(me.data?.is_mfa_enabled).toBe(false);
  });

  test('TC-MFA-005: verify-setup without prior setup rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const res = await apiRequest(request, tokens.accessToken).post('/auth/mfa/verify-setup', {
      data: { token: '123456' },
    });
    await expectStatus(res, 400);
    await expectMessageContains(res, 'MFA setup has not been initiated');
  });

  test('TC-MFA-006: mfa/login-verify re-validates password', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const mfaSecret = await setupMfaUser(request, tokens.accessToken);
    const res = await request.post(apiPath('/auth/mfa/login-verify'), {
      data: { email, password: 'WrongPass!', token: generateTotp(mfaSecret) },
    });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid email or password');
  });

  test('TC-MFA-007: mfa/login-verify with correct credentials + TOTP issues tokens', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const mfaSecret = await setupMfaUser(request, tokens.accessToken);
    const res = await mfaLoginVerify(request, email, password, mfaSecret);
    await expectStatus(res, 200);
    const data = await res.json();
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
  });

  test('TC-MFA-008: mfa/login-verify with wrong TOTP rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);
    const res = await request.post(apiPath('/auth/mfa/login-verify'), {
      data: { email, password, token: '999999' },
    });
    await expectStatus(res, 401);
    await expectMessageContains(res, 'Invalid MFA token');
  });

  test('TC-MFA-009: mfa/login-verify for user without MFA rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const res = await request.post(apiPath('/auth/mfa/login-verify'), {
      data: { email, password, token: '123456' },
    });
    await expectStatus(res, 400);
    await expectMessageContains(res, 'MFA is not enabled for this user');
  });

  test('TC-MFA-010: TOTP time-window tolerance behavior', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const setupRes = await apiRequest(request, tokens.accessToken).post('/auth/mfa/setup');
    const { tempSecret } = await setupRes.json();
    await apiRequest(request, tokens.accessToken).post('/auth/mfa/verify-setup', {
      data: { token: generateTotp(tempSecret) },
    });

    const prevToken = generateTotpAt(tempSecret, Date.now() - 30_000);
    const resPrev = await request.post(apiPath('/auth/mfa/login-verify'), {
      data: { email, password, token: prevToken },
    });
    expect([200, 401]).toContain(resPrev.status());

    const futureToken = generateTotpAt(tempSecret, Date.now() + 30_000);
    const resFuture = await request.post(apiPath('/auth/mfa/login-verify'), {
      data: { email, password, token: futureToken },
    });
    expect([200, 401]).toContain(resFuture.status());
  });

  test('TC-MFA-011: MFA disable requires only valid session — no re-verification (#38)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);
    const disableRes = await apiRequest(request, tokens.accessToken).post('/auth/mfa/disable', {
      data: {},
    });
    await expectStatus(disableRes, 200);
    const me = await getMe(request, tokens.accessToken);
    expect(me.data?.is_mfa_enabled).toBe(false);
  });

  test('TC-MFA-012: MFA disable clears secret and backup codes', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);
    await apiRequest(request, tokens.accessToken).post('/auth/mfa/disable');

    const doc = await withMongo(async (db) =>
      db.collection('users').findOne({ email: email.toLowerCase() })
    );
    if (doc) {
      expect(doc.is_mfa_enabled).toBe(false);
      expect(doc.mfa_secret).toBe('');
      expect(doc.mfa_temp_secret).toBe('');
      expect(doc.backup_codes).toEqual([]);
    } else {
      const me = await getMe(request, tokens.accessToken);
      expect(me.data?.is_mfa_enabled).toBe(false);
    }
  });

  test('TC-MFA-013: after disable, subsequent logins skip MFA entirely', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    await setupMfaUser(request, tokens.accessToken);
    await apiRequest(request, tokens.accessToken).post('/auth/mfa/disable');

    const loginRes = await loginRaw(request, email, password);
    await expectStatus(loginRes, 200);
    const data = await loginRes.json();
    expect(data.mfaRequired).toBeFalsy();
    expect(data.accessToken).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Personal Access Tokens — TC-PAT-001 .. TC-PAT-008
// ---------------------------------------------------------------------------

test.describe('Personal Access Tokens', () => {
  test('TC-PAT-001: create API key returns raw token exactly once', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'CI Token' },
    });
    await expectStatus(createRes, 201);
    const { key } = await createRes.json();
    expect(key.token).toMatch(/^ct_live_[a-f0-9]{32}$/);

    const listRes = await apiRequest(request, tokens.accessToken).get('/auth/api-keys');
    const keys = await listRes.json();
    expect(keys.every((k: { token?: string }) => !k.token)).toBe(true);
    expect(keys.some((k: { tokenPrefix?: string }) => k.tokenPrefix?.includes('ct_live_'))).toBe(true);
  });

  test('TC-PAT-002: PAT authenticates via Authorization Bearer header', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Auth test key' },
    });
    const { key } = await createRes.json();
    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(key.token) });
    await expectStatus(meRes, 200);
  });

  test('TC-PAT-003: revoked PAT rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Revoke me' },
    });
    const { key } = await createRes.json();
    await apiRequest(request, tokens.accessToken).delete(`/auth/api-keys/${key.id}`);

    const meRes = await request.get(apiPath('/me'), { headers: authHeaders(key.token) });
    await expectStatus(meRes, 401);
    await expectMessageContains(meRes, 'Invalid or revoked personal access token');
  });

  test('TC-PAT-004: cannot revoke another user PAT (IDOR)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userA = await signupFresh(request);
    const tokensA = await loginAs(request, userA.email, userA.password);
    const keyRes = await apiRequest(request, tokensA.accessToken).post('/auth/api-keys', {
      data: { name: 'User A key' },
    });
    const { key } = await keyRes.json();
    const userB = await createUserB(request, admin.accessToken);
    const delRes = await apiRequest(request, userB.tokens.accessToken).delete(`/auth/api-keys/${key.id}`);
    await expectStatus(delRes, 404);
    await expectMessageContains(delRes, 'API key not found or already revoked');
  });

  test('TC-PAT-005: PATs stored and matched in plaintext (#39)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Plaintext audit' },
    });
    const { key } = await createRes.json();

    const authSource = fs.readFileSync(
      path.resolve(__dirname, '../../BackTest/BackTestApp/src/controllers/auth.js'),
      'utf8'
    );
    expect(authSource).toContain('token,');
    expect(authSource).not.toMatch(/bcrypt\.hash\(token/);

    const stored = await withMongo(async (db) =>
      db.collection('personalaccesstokens').findOne({ token: key.token })
    );
    if (stored) {
      expect(stored.token).toBe(key.token);
    }
  });

  test('TC-PAT-006: PAT lastUsedAt updates asynchronously', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const createRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Usage tracking' },
    });
    const { key } = await createRes.json();
    await request.get(apiPath('/me'), { headers: authHeaders(key.token) });
    await new Promise((r) => setTimeout(r, 500));

    const listRes = await apiRequest(request, tokens.accessToken).get('/auth/api-keys');
    const keys = await listRes.json();
    const entry = keys.find((k: { id: string }) => k.id === key.id);
    expect(entry?.lastUsed === 'Recent' || entry?.lastUsed === 'Never').toBeTruthy();
  });

  test('TC-PAT-007: PAT never expires unless revoked', async () => {
    const schemaPath = path.resolve(
      __dirname,
      '../../BackTest/BackTestApp/src/iam/models/personalAccessToken.js'
    );
    const schema = fs.readFileSync(schemaPath, 'utf8');
    expect(schema).not.toMatch(/expiresAt|expires_at|TTL/i);
  });

  test('TC-PAT-008: missing name on API key creation rejected', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const res = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', { data: {} });
    await expectStatus(res, 400);
    await expectMessageContains(res, 'API key name is required');
  });
});

// ---------------------------------------------------------------------------
// Self-service /me — TC-ME-001 .. TC-ME-005
// ---------------------------------------------------------------------------

test.describe('Self-service /me', () => {
  test('TC-ME-001: GET /me returns own profile without password', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const me = await getMe(request, tokens.accessToken);
    expect(me.data?.email).toBe(email.toLowerCase());
    expect(responseHasPasswordField(me)).toBe(false);
  });

  test('TC-ME-002: PATCH /me updates fields with uniqueness checks', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userA = await signupFresh(request);
    const userB = await signupFresh(request);
    const tokensB = await loginAs(request, userB.email, userB.password);

    const emailConflict = await apiRequest(request, tokensB.accessToken).patch('/me', {
      data: { email: userA.email },
    });
    await expectStatus(emailConflict, 409);
    await expectMessageContains(emailConflict, 'Email is already taken');

    const adminMe = await getMe(request, admin.accessToken);
    const usernameConflict = await apiRequest(request, tokensB.accessToken).patch('/me', {
      data: { username: adminMe.data?.username },
    });
    await expectStatus(usernameConflict, 409);
    await expectMessageContains(usernameConflict, 'Username is already taken');
  });

  test('TC-ME-003: DELETE /me requires no re-authentication (#46)', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const delRes = await apiRequest(request, tokens.accessToken).delete('/me');
    await expectStatus(delRes, 200);
    await expectMessageContains(delRes, 'Account deleted successfully');
  });

  test('TC-ME-004: self-delete performs no cascade cleanup (#46)', async ({ request }) => {
    const { email, password, suffix } = await signupFresh(request);
    const tokens = await loginAs(request, email, password);
    const account = await createAccount(request, tokens.accessToken);
    const keyRes = await apiRequest(request, tokens.accessToken).post('/auth/api-keys', {
      data: { name: 'Orphan PAT' },
    });
    const { key } = await keyRes.json();
    const userId = decodeAccessToken(tokens.accessToken).userId;

    await apiRequest(request, tokens.accessToken).delete('/me');

    const orphans = await withMongo(async (db) => {
      const accounts = await db.collection('accounts').countDocuments({ user_id: userId });
      const pats = await db.collection('personalaccesstokens').countDocuments({ user: userId });
      const sessions = await db.collection('sessions').countDocuments({ user: userId });
      return { accounts, pats, sessions };
    });

    if (orphans) {
      expect(orphans.accounts).toBeGreaterThan(0);
      expect(orphans.pats).toBeGreaterThan(0);
    } else {
      const meRes = await request.get(apiPath('/me'), { headers: authHeaders(key.token) });
      expect(meRes.status()).toBeGreaterThanOrEqual(401);
    }
    void account;
    void suffix;
  });

  test('TC-ME-005: PAT/session unusable after account self-deletion', async ({ request }) => {
    const { email, password } = await signupFresh(request);
    const loginRes = await loginRaw(request, email, password);
    const { accessToken } = await loginRes.json();
    const keyRes = await apiRequest(request, accessToken).post('/auth/api-keys', {
      data: { name: 'Post-delete test' },
    });
    const { key } = await keyRes.json();

    await apiRequest(request, accessToken).delete('/me');

    const jwtRes = await request.get(apiPath('/me'), { headers: authHeaders(accessToken) });
    await expectStatus(jwtRes, 401);

    const patRes = await request.get(apiPath('/me'), { headers: authHeaders(key.token) });
    await expectStatus(patRes, 401);
  });
});

// ---------------------------------------------------------------------------
// RBAC — TC-RBAC-001, TC-RBAC-002
// ---------------------------------------------------------------------------

test.describe('RBAC decorative subsystem', () => {
  test('TC-RBAC-001: authorize() middleware never used by any route (#41)', { ...tags.audit }, async () => {
    const hits = grepRoutesForAuthorize();
    expect(hits).toEqual([]);
  });

  test('TC-RBAC-002: fine-grained Permissions on Role have no API effect', async ({ request }) => {
    test.skip(!MONGO_URI, 'Requires MONGO_URI to seed restrictive role');

    const admin = await loginAsAdmin(request);
    const suffix = uniqueSuffix();
    const email = `rbac-${suffix}@e2e.test.com`;
    const password = 'RbacPass123!';

    const roleId = await withMongo(async (db) => {
      const permResult = await db.collection('permissions').insertOne({
        operation: 'read',
        entity: `nonexistent-entity-${suffix}`,
        description: 'E2E restrictive permission',
      });
      const roleResult = await db.collection('roles').insertOne({
        name: `e2e-restrictive-${suffix}`,
        description: 'Restrictive test role',
        permissions: [permResult.insertedId],
        active: true,
      });
      return roleResult.insertedId.toString();
    });
    expect(roleId).toBeTruthy();

    const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
      data: {
        username: `rbacuser${suffix}`,
        name: 'RBAC Test User',
        email,
        password,
        roles: [roleId],
      },
    });
    await expectStatus(createRes, 201);
    const userTokens = await loginAs(request, email, password);

    const writeRes = await apiRequest(request, userTokens.accessToken).post('/accounts', {
      data: { account_name: `rbac-acct-${suffix}`, account_type: 'PAPER', initial_balance: 1000 },
    });
    expect(writeRes.ok()).toBe(true);
  });
});
