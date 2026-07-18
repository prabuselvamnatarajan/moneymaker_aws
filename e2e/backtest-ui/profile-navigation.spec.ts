import { test, expect, type Page } from '@playwright/test';
import { API_BASE, getMe, loginAsUser, uniqueSuffix } from '../fixtures/auth';
import { createAccount, getInternalBroker } from '../fixtures/factories';
import {
  loginViaUI,
  navigateTo,
  openProfile,
  openRegisterAccountDialog,
  openResourceOverview,
} from './helpers/nav';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trackApiCalls(page: Page, pattern: RegExp): string[] {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (pattern.test(req.url())) {
      calls.push(`${req.method()} ${req.url()}`);
    }
  });
  return calls;
}

// ---------------------------------------------------------------------------
// Profile & navigation — TC-UI-046 .. TC-UI-051
// ---------------------------------------------------------------------------

test.describe('Profile and navigation resilience', () => {
  test('TC-UI-046: loadData aborts subsequent fetches when accounts.list fails', async ({ page }) => {
    let accountsHit = false;

    await page.route('**/api/accounts**', async (route) => {
      if (route.request().method() === 'GET' && !route.request().url().includes('/accounts/')) {
        accountsHit = true;
        await route.fulfill({ status: 500, body: JSON.stringify({ message: 'accounts unavailable' }) });
        return;
      }
      await route.continue();
    });

    const symbolsCalls: string[] = [];
    const deploymentsCalls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/api/symbols') && !req.url().includes('candles')) {
        symbolsCalls.push(req.url());
      }
      if (req.method() === 'GET' && req.url().includes('/api/deployments')) {
        deploymentsCalls.push(req.url());
      }
    });

    await loginViaUI(page);
    expect(accountsHit).toBe(true);
    expect(symbolsCalls).toHaveLength(0);
    expect(deploymentsCalls).toHaveLength(0);
  });

  test('TC-UI-047: strategy definitions fetch failure does not block other loadData resources', async ({
    page,
  }) => {
    let strategiesFailed = false;

    await page.route('**/api/strategies**', async (route) => {
      if (route.request().method() === 'GET') {
        strategiesFailed = true;
        await route.fulfill({ status: 500, body: JSON.stringify({ message: 'strategies unavailable' }) });
        return;
      }
      await route.continue();
    });

    const accountsCalls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/api/accounts') && !req.url().includes('/accounts/')) {
        accountsCalls.push(req.url());
      }
    });

    await loginViaUI(page);
    expect(strategiesFailed).toBe(true);
    expect(accountsCalls.length).toBeGreaterThan(0);
    await expect(page.locator('#nav-dashboard-btn')).toBeVisible();
    await expect(page.getByText(/Dashboard|Brokerage|Net Liquidation/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('TC-UI-048: full-page spinner only shows when accounts list is empty', async ({
    page,
    request,
  }) => {
    await loginViaUI(page);
    await expect(page.getByText('Loading Platform Audits')).not.toBeVisible();

    await openResourceOverview(page, 'accounts');
    await openRegisterAccountDialog(page);

    const accountName = `e2e-spinner-${uniqueSuffix()}`;
    await page.locator('form').filter({ hasText: 'Register New Brokerage' }).locator('input[type="text"]').first().fill(accountName);
    await page.locator('form').filter({ hasText: 'Register New Brokerage' }).locator('input[type="number"]').first().fill('25000');

    await page.getByRole('button', { name: 'Save Broker Record' }).click();
    await expect(page.getByText(accountName)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Loading Platform Audits')).not.toBeVisible();
  });

  test('TC-UI-049: profile Save Changes does not PATCH /api/me', async ({ page, request }) => {
    const { accessToken, email } = await loginAsUser(request);
    const meBefore = await getMe(request, accessToken);

    await loginViaUI(page);
    await openProfile(page);

    const mePatchCalls = trackApiCalls(page, /\/api\/me\b/);

    await page.getByRole('button', { name: 'Edit Profile' }).click();
    await page.locator('form').filter({ hasText: 'Full Name' }).locator('input[type="text"]').first().fill('E2E Renamed User');
    await page.locator('form').filter({ hasText: 'Username' }).locator('input[type="text"]').fill(`e2e${uniqueSuffix().slice(-6)}`);
    await page.locator('form').filter({ hasText: 'Email Address' }).locator('input[type="email"]').fill(`e2e-${uniqueSuffix()}@test.local`);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText('Profile identity updated successfully')).toBeVisible({ timeout: 10_000 });
    expect(mePatchCalls.filter((c) => c.startsWith('PATCH'))).toHaveLength(0);

    await page.reload();
    await page.locator('#nav-dashboard-btn').waitFor({ timeout: 30_000 });
    await openProfile(page);
    await expect(page.getByText(meBefore.email || email)).toBeVisible();
  });

  test('TC-UI-050: CORS preflight omits PATCH from Access-Control-Allow-Methods (#50)', async ({
    page,
  }) => {
    const result = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/api/me`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'PATCH',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });
      return {
        status: res.status,
        allowMethods: res.headers.get('Access-Control-Allow-Methods'),
      };
    }, API_BASE);

    expect(result.status).toBeLessThan(500);
    expect(result.allowMethods).toBeTruthy();
    expect(result.allowMethods).toMatch(/GET/);
    expect(result.allowMethods).not.toContain('PATCH');
  });

  test('TC-UI-051: navigation is activeScreen state only — no deep links or history', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const broker = await getInternalBroker(request, accessToken);
    const account = await createAccount(request, accessToken, {
      account_name: `e2e-nav-${uniqueSuffix()}`,
      broker_id: broker._id,
    });

    await loginViaUI(page);
    const rootUrl = page.url();

    await openResourceOverview(page, 'accounts');
    await expect(page.getByText('Brokerage Accounts Directory')).toBeVisible();
    expect(page.url()).toBe(rootUrl);

    await page.locator(`#sidebar-acc-${account._id}`).click();
    await expect(page.getByText(account.account_name)).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toBe(rootUrl);

    await openProfile(page);
    await expect(page.getByRole('heading', { name: 'Operator Profile & Security Center' })).toBeVisible();
    expect(page.url()).toBe(rootUrl);

    const copiedUrl = page.url();
    const newTab = await page.context().newPage();
    await newTab.goto(copiedUrl);
    await expect(newTab.locator('input[type="email"]').first()).toBeVisible({ timeout: 15_000 });
    await newTab.close();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Operator Profile & Security Center' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Operator Profile & Security Center' })).toBeVisible();
  });
});
