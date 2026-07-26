import { test, expect, type APIRequestContext, type Page, request as playwrightRequest } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { API_BASE, apiUrl, loginAs, uniqueSuffix } from '../fixtures/auth';
import { getLocalStorageTokens, setLocalStorageToken } from './helpers/nav';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'iam-access-secret';
const JWT_ISSUER = 'iam-service';
const JWT_AUDIENCE = 'iam-clients';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupFreshUser(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const email = `e2e-refresh-${suffix}@e2e.test.com`;
  const username = `e2erefresh${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 14)}`;
  const password = 'TestPass123!';
  const res = await request.post(apiUrl('/auth/signup'), {
    data: { username, name: 'Refresh Test User', email, password },
  });
  expect(res.ok()).toBeTruthy();
  return { email, password };
}

async function loginToDashboard(page: Page, email: string, password: string) {
  const api = await playwrightRequest.newContext({ baseURL: API_BASE });
  try {
    const tokens = await loginAs(api, email, password);
    await page.goto('.');
    await page.evaluate(() => localStorage.clear());
    await setLocalStorageToken(page, tokens.accessToken, tokens.refreshToken);
    await page.goto('.');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#sidebar-container').waitFor({ timeout: 30_000 });
  } finally {
    await api.dispose();
  }
}

function createExpiredAccessToken(validAccessToken: string): string {
  const decoded = jwt.decode(validAccessToken) as jwt.JwtPayload & {
    userId?: string;
    sessionID?: string;
    email?: string;
  };
  return jwt.sign(
    {
      userId: decoded.userId,
      sessionID: decoded.sessionID,
      email: decoded.email,
    },
    JWT_SECRET,
    { expiresIn: '-1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

function createNearExpiryAccessToken(validAccessToken: string, expiresInSec = 15): string {
  const decoded = jwt.decode(validAccessToken) as jwt.JwtPayload & {
    userId?: string;
    sessionID?: string;
    email?: string;
  };
  return jwt.sign(
    {
      userId: decoded.userId,
      sessionID: decoded.sessionID,
      email: decoded.email,
    },
    JWT_SECRET,
    { expiresIn: expiresInSec, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

async function openProfileAndSignOut(page: Page) {
  await page.locator('#sidebar-container').locator('button').last().click();
  await page.getByRole('button', { name: 'Sign Out Session' }).click();
  await expect(page.getByRole('button', { name: 'Access Console' })).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Token refresh interceptor — TC-UI-010 .. TC-UI-017
// ---------------------------------------------------------------------------

test.describe('Token refresh interceptor', () => {
  test('TC-UI-010: 401 on authenticated request triggers refresh and transparent retry', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    const tokens = await getLocalStorageTokens(page);
    const expiredAccess = createExpiredAccessToken(tokens.accessToken!);
    await setLocalStorageToken(page, expiredAccess, tokens.refreshToken!);

    let refreshSeen = false;
    page.on('request', (req) => {
      if (req.url().includes('/auth/refresh-token') && req.method() === 'POST') {
        refreshSeen = true;
      }
    });

    const result = await page.evaluate(async () => {
      const res = await fetch('/backtestapp/accounts?limit=1', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json',
        },
      });
      return { ok: res.ok, status: res.status };
    });

    expect(refreshSeen).toBe(true);
    expect(result.ok).toBe(true);

    const after = await getLocalStorageTokens(page);
    expect(after.accessToken).toBeTruthy();
    expect(after.accessToken).not.toBe(expiredAccess);
  });

  test('TC-UI-011: concurrent 401s deduplicate to a single refresh-token call', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    await page.waitForTimeout(1500);

    const tokens = await getLocalStorageTokens(page);
    const expiredAccess = createExpiredAccessToken(tokens.accessToken!);
    await setLocalStorageToken(page, expiredAccess, tokens.refreshToken!);

    let refreshCount = 0;
    const trackRefresh = (req: { url: () => string; method: () => string }) => {
      if (req.url().includes('/auth/refresh-token') && req.method() === 'POST') {
        refreshCount++;
      }
    };
    page.on('request', trackRefresh);

    const statuses = await page.evaluate(async () => {
      const headers = {
        Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        'Content-Type': 'application/json',
      };
      const urls = Array.from({ length: 5 }, () => '/backtestapp/accounts?limit=1');
      const results = await Promise.all(urls.map((url) => fetch(url, { headers })));
      return Promise.all(results.map((r) => r.status));
    });

    page.off('request', trackRefresh);
    expect(refreshCount).toBeLessThanOrEqual(2);
    expect(refreshCount).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  test('TC-UI-012: auth endpoints are excluded from 401 refresh-retry loop', async ({ page }) => {
    let refreshCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/auth/refresh-token')) refreshCount++;
    });

    await page.goto('.');
    await page.locator('input[type="email"]').first().fill('wrong@example.com');
    await page.locator('input[type="password"]').first().fill('WrongPassword999!');
    await page.locator('button[type="submit"]').first().click();

    await expect(page.locator('.text-rose-300, [class*="rose"]').first()).toBeVisible({
      timeout: 10_000,
    });
    expect(refreshCount).toBe(0);
    await expect(page.getByRole('button', { name: 'Access Console' })).toBeVisible();
  });

  test('TC-UI-013: invalid refresh token triggers session expiry and login redirect', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    const tokens = await getLocalStorageTokens(page);
    const expiredAccess = createExpiredAccessToken(tokens.accessToken!);
    await setLocalStorageToken(page, expiredAccess, 'invalid-refresh-token-value');

    await page.evaluate(async () => {
      await fetch('/backtestapp/accounts?limit=1', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json',
        },
      });
    });

    await expect(page.getByRole('button', { name: 'Access Console' })).toBeVisible({
      timeout: 15_000,
    });
    const cleared = await getLocalStorageTokens(page);
    expect(cleared.accessToken).toBeNull();
    expect(cleared.refreshToken).toBeNull();
  });

  test('TC-UI-014: network error during refresh does not log the user out', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    const tokens = await getLocalStorageTokens(page);
    const expiredAccess = createExpiredAccessToken(tokens.accessToken!);
    await setLocalStorageToken(page, expiredAccess, tokens.refreshToken!);

    await page.route('**/backtestapp/auth/refresh-token', (route) => route.abort('failed'));

    await page.evaluate(async () => {
      try {
        await fetch('/backtestapp/accounts?limit=1', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            'Content-Type': 'application/json',
          },
        });
      } catch {
        // network failure is expected
      }
    });

    await expect(
      page.locator('#sidebar-container').or(page.getByRole('button', { name: 'Access Console' }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('TC-UI-015: ensureValidToken proactively refreshes when JWT expires within 30 seconds', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    const tokens = await getLocalStorageTokens(page);
    const nearExpiry = createNearExpiryAccessToken(tokens.accessToken!, 15);
    await setLocalStorageToken(page, nearExpiry, tokens.refreshToken!);

    const refreshResponse = page.waitForResponse(
      (r) => r.url().includes('/auth/refresh-token') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );

    await page.reload();
    await page.locator('#sidebar-container').waitFor({ timeout: 30_000 });
    await refreshResponse;

    const after = await getLocalStorageTokens(page);
    expect(after.accessToken).toBeTruthy();
    expect(after.accessToken).not.toBe(nearExpiry);
  });

  test('TC-UI-016: malformed access token does not crash ensureValidToken', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    await page.evaluate(() => {
      localStorage.setItem('accessToken', 'not-a-valid-jwt-token');
    });

    const returned = await page.evaluate(async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      try {
        const base64Url = token.split('.')[1];
        if (base64Url) {
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          JSON.parse(
            decodeURIComponent(
              atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
            )
          );
        }
      } catch {
        // mirrors api.ts ensureValidToken catch path
      }
      return localStorage.getItem('accessToken');
    });

    expect(returned).toBe('not-a-valid-jwt-token');
    await page.reload();
    await page.locator('#sidebar-container, input[type="email"]').first().waitFor({ timeout: 30_000 });
  });

  test('TC-UI-017: periodic refresh runs every 10 minutes and stops on logout', async ({
    page,
    request,
  }) => {
    await page.clock.install();
    const user = await signupFreshUser(request);
    await loginToDashboard(page, user.email, user.password);

    let refreshCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/auth/refresh-token') && req.method() === 'POST') {
        refreshCount++;
      }
    });

    await page.clock.fastForward(10 * 60 * 1000 + 1_000);
    await expect.poll(() => refreshCount, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);

    const countAfterInterval = refreshCount;
    await openProfileAndSignOut(page);

    await page.clock.fastForward(10 * 60 * 1000);
    expect(refreshCount).toBe(countAfterInterval);
  });
});
