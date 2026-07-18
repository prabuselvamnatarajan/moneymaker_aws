import { test, expect, type Page } from '@playwright/test';
import { loginAsUser, uniqueSuffix } from '../fixtures/auth';
import { createAccount, createStrategy, createSymbol, getInternalBroker } from '../fixtures/factories';
import {
  loginViaUI,
  navigateTo,
  openRegisterAccountDialog,
  openResourceOverview,
  openAccountDetail,
} from './helpers/nav';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillAccountRegistrationForm(
  page: Page,
  opts: {
    name: string;
    balance: string;
    accountType?: 'SIMULATION' | 'PAPER' | 'LIVE';
    commissionType?: 'PERCENTAGE' | 'FLAT';
    commissionRate?: string;
  }
) {
  const form = page.locator('form').filter({ hasText: 'Register New Brokerage' });
  await form.locator('input[type="text"]').first().fill(opts.name);
  if (opts.accountType) {
    await form.locator('select').first().selectOption(opts.accountType);
  }
  await form.locator('input[type="number"]').first().fill(opts.balance);
  const commissionSelect = form.locator('select').nth(1);
  if (opts.commissionType) {
    await commissionSelect.selectOption(opts.commissionType);
  }
  if (opts.commissionRate !== undefined) {
    await form.locator('input[type="number"]').nth(2).fill(opts.commissionRate);
  }
}

// ---------------------------------------------------------------------------
// CRUD list views — TC-UI-031 .. TC-UI-037
// ---------------------------------------------------------------------------

test.describe('CRUD list views', () => {
  test('TC-UI-031: account creation maps UI fields to api.accounts.create payload', async ({
    page,
    request,
  }) => {
    await loginViaUI(page);
    await openResourceOverview(page, 'accounts');

    const createPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/accounts'),
      { timeout: 30_000 }
    );

    await openRegisterAccountDialog(page);
    const accountName = `e2e-ui-acc-${uniqueSuffix()}`;
    await fillAccountRegistrationForm(page, {
      name: accountName,
      balance: '75000',
      accountType: 'PAPER',
      commissionType: 'FLAT',
      commissionRate: '15',
    });
    await page.getByRole('button', { name: 'Save Broker Record' }).click();

    const createReq = await createPromise;
    const payload = createReq.postDataJSON() as Record<string, unknown>;

    expect(payload.account_name).toBe(accountName);
    expect(payload.account_type).toBe('PAPER');
    expect(payload.initial_balance).toBe(75000);
    expect(payload.commission_type).toBe('FLAT');
    expect(payload.commission_rate).toBe(15);
    expect(String(payload.description)).toMatch(/^broker:/);
    expect(payload.broker_id).toBeTruthy();
  });

  test('TC-UI-032: deleting selected account redirects to accounts list with cascade toast', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const broker = await getInternalBroker(request, accessToken);
    const suffix = uniqueSuffix();
    const accountName = `e2e-del-${suffix}`;
    const account = await createAccount(request, accessToken, {
      account_name: accountName,
      broker_id: broker._id,
      initial_balance: 50000,
    });

    await loginViaUI(page);
    await openAccountDetail(page, account._id);

    await page.getByTitle('Delete Account').click();
    await page.locator('#btn-confirm-delete-acc-details').locator('..').locator('input').fill(accountName);
    await page.locator('#btn-confirm-delete-acc-details').click();

    await expect(page.getByText('Brokerage Accounts Directory')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('#toast-container').getByText(/deployments.*trades.*positions.*ledgers/i)
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`#sidebar-acc-${account._id}`)).not.toBeVisible();
  });

  test('TC-UI-033: broker status toggle reverts when api.accounts.update fails', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const broker = await getInternalBroker(request, accessToken);
    const account = await createAccount(request, accessToken, {
      account_name: `e2e-toggle-${uniqueSuffix()}`,
      broker_id: broker._id,
      is_active: true,
    });

    await loginViaUI(page);
    await openResourceOverview(page, 'accounts');

    await page.route('**/api/accounts/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, body: JSON.stringify({ message: 'Simulated failure' }) });
        return;
      }
      await route.continue();
    });

    const statusPill = page.getByText('API SESSION ACTIVE').first();
    await expect(statusPill).toBeVisible();
    await statusPill.click();

    await expect(page.locator('#toast-container').getByText(/failed to update account state/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('API SESSION ACTIVE').first()).toBeVisible();
  });

  test('TC-UI-034: strategy template create, edit, and delete use definition endpoints', async ({
    page,
    request,
  }) => {
    await loginViaUI(page);
    await openResourceOverview(page, 'templates');

    const templateName = `e2e-template-${uniqueSuffix()}`;
    const createPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/strategies'),
      { timeout: 30_000 }
    );

    await page.locator('input[placeholder="e.g. Bollinger Bands Breakout"]').fill(templateName);
    await page
      .locator('textarea[placeholder*="Describe trade rules"]')
      .fill('E2E strategy template description');
    await page.getByRole('button', { name: 'Create Template' }).click();
    await createPromise;

    const templateRow = page.locator('div').filter({ hasText: templateName }).first();
    await expect(templateRow).toBeVisible({ timeout: 15_000 });

    const updatedName = `${templateName}-edited`;
    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/api/strategies/'),
      { timeout: 30_000 }
    );
    await templateRow.getByTitle('Edit Strategy Template').click();
    await page.locator('form').filter({ hasText: 'Edit Strategy Template' }).locator('input[type="text"]').first().fill(updatedName);
    await page.getByRole('button', { name: 'Update Template' }).click();
    await patchPromise;
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 15_000 });

    const deletePromise = page.waitForRequest(
      (req) => req.method() === 'DELETE' && req.url().includes('/api/strategies/'),
      { timeout: 30_000 }
    );
    await page.locator('div').filter({ hasText: updatedName }).first().getByTitle('Delete Strategy Template').click();
    await page.locator('#btn-confirm-delete-template').locator('..').locator('input').fill(updatedName);
    await page.locator('#btn-confirm-delete-template').click();
    await deletePromise;
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 15_000 });
  });

  test('TC-UI-035: symbol activation toggle updates list and survives reload', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const symbol = await createSymbol(request, accessToken, {
      symbol: `E2E${uniqueSuffix().slice(-6)}`,
      is_active: false,
    });

    await loginViaUI(page);
    await openResourceOverview(page, 'symbols');

    const row = page.locator('tr').filter({ hasText: symbol.symbol });
    await expect(row.getByText('Inactive')).toBeVisible({ timeout: 15_000 });

    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes(`/api/symbols/${symbol._id}`),
      { timeout: 30_000 }
    );
    await row.getByRole('button', { name: 'Activate' }).click();
    await patchPromise;

    await expect(page.locator('#toast-container').getByText(/activated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(row.getByText('Active')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(row.getByText('Active')).toBeVisible({ timeout: 15_000 });
  });

  test('TC-UI-036: bulk option creation sends range/moneyness/option-type payload', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    await createSymbol(request, accessToken, {
      symbol: 'NIFTY',
      instrument_token: `NIFTY-${uniqueSuffix()}`,
      instrument_class: 'INDEX',
      is_active: true,
      strike_price_diff: 50,
    });

    await loginViaUI(page);
    await openResourceOverview(page, 'symbols');

    await page.locator('#btn-track-symbol-trigger').click();
    await page.getByRole('button', { name: 'Add Bulk Symbols' }).click();

    const bulkPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/symbols/bulk'),
      { timeout: 30_000 }
    );

    await page.locator('select').filter({ has: page.locator('option', { hasText: 'NIFTY' }) }).selectOption('NIFTY');
    await page.locator('input[type="date"]').fill('2026-12-25');
    await page.locator('select').filter({ hasText: 'ITM (In The Money)' }).selectOption('OTM');
    await page.locator('select').filter({ hasText: 'Call (CE Only)' }).selectOption('Both');
    await page.locator('input[type="number"]').fill('3');
    await page.getByRole('button', { name: 'Fetch & Add Chain' }).click();

    const bulkReq = await bulkPromise;
    const payload = bulkReq.postDataJSON() as Record<string, unknown>;
    expect(payload.symbol).toBe('NIFTY');
    expect(payload.range_count).toBe(3);
    expect(payload.range_option).toBe('OTM');
    expect(payload.option_type).toBe('Both');
    expect(payload.expiry).toBe('2026-12-25');
  });

  test('TC-UI-037: brokers list refreshes on broker-updated DOM event', async ({ page }) => {
    await loginViaUI(page);
    await navigateTo(page, 'brokers');

    await expect(page.getByRole('heading', { name: /Brokers/i })).toBeVisible({ timeout: 15_000 });

    const refreshPromise = page.waitForRequest(
      (req) => req.method() === 'GET' && req.url().includes('/api/brokers'),
      { timeout: 15_000 }
    );

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('broker-updated', { detail: { event: 'broker_updated' } }));
    });

    await refreshPromise;
  });
});
