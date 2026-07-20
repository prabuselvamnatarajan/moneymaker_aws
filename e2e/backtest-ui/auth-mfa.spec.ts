import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { apiPath, apiRequest, loginAs, uniqueSuffix } from '../fixtures/auth';
import { generateTotp } from '../fixtures/totp';
import { getLocalStorageTokens } from './helpers/nav';

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'iam-access-secret';
const JWT_ISSUER = 'iam-service';
const JWT_AUDIENCE = 'iam-clients';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupFreshUser(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const email = `e2e-ui-${suffix}@e2e.test.com`;
  const username = `e2eui${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
  const password = 'TestPass123!';
  const name = 'E2E UI User';
  const res = await request.post(apiPath('/auth/signup'), {
    data: { username, name, email, password },
  });
  expect(res.ok(), `signup failed: ${await res.text()}`).toBeTruthy();
  return { email, username, password, name };
}

async function setupMfaForUser(
  request: APIRequestContext,
  accessToken: string
): Promise<string> {
  const setupRes = await apiRequest(request, accessToken).post('/auth/mfa/setup');
  expect(setupRes.ok()).toBeTruthy();
  const setup = await setupRes.json();
  const verifyRes = await apiRequest(request, accessToken).post('/auth/mfa/verify-setup', {
    data: { token: generateTotp(setup.tempSecret) },
  });
  expect(verifyRes.ok()).toBeTruthy();
  return setup.tempSecret as string;
}

async function fillLoginCredentials(page: Page, email: string, password: string) {
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
}

async function submitAuthForm(page: Page) {
  await page.locator('button[type="submit"]').first().click();
}

async function loginToMfaSetup(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await fillLoginCredentials(page, email, password);
  await submitAuthForm(page);
  await expect(page.getByRole('heading', { name: 'Protect Your Account' })).toBeVisible({
    timeout: 30_000,
  });
}

async function loginToDashboardViaSkip(page: Page, email: string, password: string) {
  await loginToMfaSetup(page, email, password);
  await page.getByRole('button', { name: /skip for now/i }).click();
  await page.locator('#sidebar-container').waitFor({ timeout: 30_000 });
}

async function openProfileAndSignOut(page: Page) {
  await page.locator('#sidebar-container').locator('button').last().click();
  await page.getByRole('button', { name: 'Sign Out Session' }).click();
}

// ---------------------------------------------------------------------------
// Authentication & MFA — TC-UI-001 .. TC-UI-009
// ---------------------------------------------------------------------------

test.describe('Authentication & MFA', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('TC-UI-001: login without MFA redirects to MFA setup, not dashboard', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);

    await page.goto('/');
    await fillLoginCredentials(page, user.email, user.password);
    await submitAuthForm(page);

    await expect(page.getByRole('heading', { name: 'Protect Your Account' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#sidebar-container')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /skip for now/i })).toBeVisible();
  });

  test('TC-UI-002: MFA-enabled user sees verification screen instead of dashboard', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    const tokens = await loginAs(request, user.email, user.password);
    await setupMfaForUser(request, tokens.accessToken);

    await page.goto('/');
    await fillLoginCredentials(page, user.email, user.password);
    await submitAuthForm(page);

    await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#sidebar-container')).not.toBeVisible();
    await expect(page.getByPlaceholder('000 000')).toBeVisible();
  });

  test('TC-UI-003: MFA login verify sends email, password, and TOTP code', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    const tokens = await loginAs(request, user.email, user.password);
    const mfaSecret = await setupMfaForUser(request, tokens.accessToken);

    await page.goto('/');
    await fillLoginCredentials(page, user.email, user.password);
    await submitAuthForm(page);
    await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();

    const verifyRequest = page.waitForRequest(
      (req) =>
        req.url().includes('/auth/mfa/login-verify') && req.method() === 'POST',
      { timeout: 15_000 }
    );

    await page.getByPlaceholder('000 000').fill(generateTotp(mfaSecret));
    await page.getByRole('button', { name: 'Verify & Log In' }).click();

    const req = await verifyRequest;
    const body = req.postDataJSON() as { email: string; password: string; token: string };
    expect(body.email).toBe(user.email);
    expect(body.password).toBe(user.password);
    expect(body.token).toMatch(/^\d{6}$/);

    await page.locator('#sidebar-container').waitFor({ timeout: 30_000 });
    const stored = await getLocalStorageTokens(page);
    expect(stored.accessToken).toBeTruthy();
    expect(stored.refreshToken).toBeTruthy();
  });

  test('TC-UI-004: Skip for now on MFA setup bypasses enrollment and reaches dashboard', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);

    await loginToMfaSetup(page, user.email, user.password);
    await page.getByRole('button', { name: /skip for now/i }).click();

    await page.locator('#sidebar-container').waitFor({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Protect Your Account' })).not.toBeVisible();

    const meRes = await request.get(apiPath('/me'), {
      headers: { Authorization: `Bearer ${(await getLocalStorageTokens(page)).accessToken}` },
    });
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    expect(me.data.is_mfa_enabled).toBe(false);
  });

  test('TC-UI-005: MFA setup renders QR, manual secret, and copy-to-clipboard works', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToMfaSetup(page, user.email, user.password);

    const qrImage = page.locator('img[alt="MFA QR Code"]');
    await expect(qrImage).toBeVisible({ timeout: 15_000 });
    await expect(qrImage).toHaveAttribute('src', /^data:image\//);

    const secretText = page.locator('span.font-mono.text-xs.text-slate-300.font-bold.select-all');
    await expect(secretText).not.toBeEmpty();
    const secret = (await secretText.textContent())?.trim() ?? '';
    expect(secret.length).toBeGreaterThan(8);

    await page.locator('button[title="Copy setup secret"]').click();
    await expect(page.locator('svg.lucide-check, .lucide-check').first()).toBeVisible({
      timeout: 3_000,
    });

    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
    expect(clipboardText).toBe(secret);
  });

  test('TC-UI-006: invalid TOTP on setup shows error without clearing QR/secret', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToMfaSetup(page, user.email, user.password);

    await expect(page.locator('img[alt="MFA QR Code"]')).toBeVisible({ timeout: 15_000 });
    const secretBefore = await page
      .locator('span.font-mono.text-xs.text-slate-300.font-bold.select-all')
      .textContent();

    await page.getByPlaceholder('000 000').fill('000000');
    await page.getByRole('button', { name: 'Verify & Enable' }).click();

    await expect(page.locator('.text-rose-300 span, [class*="rose"] span').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('img[alt="MFA QR Code"]')).toBeVisible();
    const secretAfter = await page
      .locator('span.font-mono.text-xs.text-slate-300.font-bold.select-all')
      .textContent();
    expect(secretAfter).toBe(secretBefore);
  });

  test('TC-UI-007: Developer Seed Profiles quick-fill buttons expose credentials on login page', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Developer Seed Profiles')).toBeVisible();

    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await page.getByRole('button', { name: 'Admin Profile' }).click();
    await expect(emailInput).toHaveValue('admin@cobratrades.com');
    await expect(passwordInput).toHaveValue('adminpassword123');

    await page.getByRole('button', { name: 'Standard User' }).click();
    await expect(emailInput).toHaveValue('user@cobratrades.com');
    await expect(passwordInput).toHaveValue('userpassword123');
  });

  test('TC-UI-008: signup auto-logs in then shows forced MFA setup screen', async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `e2e-signup-ui-${suffix}@e2e.test.com`;
    const username = `e2esignupui${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
    const password = 'SignupPass123!';

    await page.goto('/');
    await page.getByRole('button', { name: /Don't have an account/i }).click();

    await page.locator('input[placeholder="John Doe"]').fill('Signup UI User');
    await page.locator('input[placeholder="johndoe"]').fill(username);
    await fillLoginCredentials(page, email, password);

    const signupResponse = page.waitForResponse(
      (r) => r.url().includes('/auth/signup') && r.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await submitAuthForm(page);
    const signupRes = await signupResponse;
    expect(signupRes.ok()).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Protect Your Account' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#sidebar-container')).not.toBeVisible();

    const tokens = await getLocalStorageTokens(page);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  test('TC-UI-009: logout clears localStorage even when server logout fails', async ({
    page,
    request,
  }) => {
    const user = await signupFreshUser(request);
    await loginToDashboardViaSkip(page, user.email, user.password);

    const beforeLogout = await getLocalStorageTokens(page);
    expect(beforeLogout.accessToken).toBeTruthy();
    expect(beforeLogout.refreshToken).toBeTruthy();

    await page.route('**/backtestapp/auth/logout', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ message: 'Server error' }) })
    );

    await openProfileAndSignOut(page);

    await expect(page.getByRole('button', { name: 'Access Console' })).toBeVisible({
      timeout: 15_000,
    });
    const afterLogout = await getLocalStorageTokens(page);
    expect(afterLogout.accessToken).toBeNull();
    expect(afterLogout.refreshToken).toBeNull();
  });
});
