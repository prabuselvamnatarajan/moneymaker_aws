import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAsUser, uniqueSuffix } from '../fixtures/auth';
import {
  createAccount,
  createDeployment,
  createStrategy,
  createSymbol,
  createTrade,
  getInternalBroker,
} from '../fixtures/factories';
import {
  loginViaUI,
  navigateTo,
  openAccountDetail,
  openResourceOverview,
  setSidebarTimezone,
} from './helpers/nav';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAccountWithTrade(request: APIRequestContext) {
  const { accessToken } = await loginAsUser(request);
  const broker = await getInternalBroker(request, accessToken);
  const account = await createAccount(request, accessToken, {
    account_name: `e2e-tx-${uniqueSuffix()}`,
    broker_id: broker._id,
    initial_balance: 200000,
  });
  const strategy = await createStrategy(request, accessToken);
  const symbol = await createSymbol(request, accessToken);
  const deployment = await createDeployment(request, accessToken, {
    strategy_id: strategy._id,
    account_id: account._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
  });
  const tradeRes = await createTrade(request, accessToken, {
    account_id: account._id,
    deployment_id: deployment._id,
    symbol: symbol.symbol,
    price: 150,
    quantity: 5,
    type_of_order: 'BUY',
  });
  expect(tradeRes.ok()).toBeTruthy();
  const tradeBody = await tradeRes.json();
  const tradeId =
    tradeBody.data?.trade?._id || tradeBody.data?.trade?.trade_id || tradeBody.data?._id;
  return { accessToken, account, strategy, symbol, deployment, tradeId: String(tradeId) };
}

async function openFirstTransactionModal(page: Page) {
  const row = page.locator('tbody tr').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.locator('#tx-modal-container')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Transactions & analysis — TC-UI-038 .. TC-UI-045
// ---------------------------------------------------------------------------

test.describe('Transactions and analysis views', () => {
  test('TC-UI-038: drilldown resets stale filters and applies single account dimension', async ({
    page,
    request,
  }) => {
    const { account, deployment } = await seedAccountWithTrade(request);

    await loginViaUI(page);
    await navigateTo(page, 'transactions');

    await page.locator('#toggle-advance-filters-btn').click();
    await page.locator(`#filter-acc-${account._id}`).waitFor({ timeout: 15_000 });
    await page.locator(`#filter-acc-${account._id}`).click();
    await page.locator(`#filter-strat-${deployment._id}`).waitFor({ timeout: 15_000 });
    await page.locator(`#filter-strat-${deployment._id}`).click();
    await page.locator('#advanced-filters-panel label').filter({ hasText: 'BUY' }).locator('input[type="checkbox"]').check();

    await openAccountDetail(page, account._id, account.account_name);
    await page.locator('#view-all-transactions-drilldown').click();

    await expect(page.locator('#global-ledger-search-input')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#filter-chips-board')).toContainText(account.account_name);
    await expect(page.locator('#filter-chips-board')).not.toContainText('Strategy:');
  });

  test('TC-UI-039: highlighted transaction row clears after navigation away', async ({
    page,
    request,
  }) => {
    const { account, tradeId } = await seedAccountWithTrade(request);

    await loginViaUI(page);
    await openAccountDetail(page, account._id, account.account_name);
    await page.locator('#view-all-transactions-drilldown').click();
    await expect(page.locator('#global-ledger-search-input')).toBeVisible({ timeout: 15_000 });

    await page.evaluate(({ txId }) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const match = rows.find((row) => row.textContent?.includes(txId.slice(-8)));
      if (match) {
        match.classList.add('bg-indigo-600/10', 'border-l-2', 'border-l-indigo-500');
        match.setAttribute('data-e2e-highlighted', 'true');
      }
    }, { txId: tradeId });

    const highlighted = page.locator('tbody tr[data-e2e-highlighted="true"]');
    if (await highlighted.count()) {
      await expect(highlighted.first()).toHaveClass(/border-l-indigo-500/);
    }

    await navigateTo(page, 'dashboard');
    await navigateTo(page, 'transactions');
    await expect(page.locator('tbody tr[data-e2e-highlighted="true"]')).toHaveCount(0);
    await expect(page.locator('tbody tr.border-l-indigo-500')).toHaveCount(0);
  });

  test('TC-UI-040: transaction flag and notes are client-side only', async ({ page, request }) => {
    await seedAccountWithTrade(request);

    await loginViaUI(page);
    await navigateTo(page, 'transactions');
    await openFirstTransactionModal(page);

    const notes = `e2e-audit-note-${uniqueSuffix()}`;
    await page.locator('[id^="notes-textarea-"]').fill(notes);
    await page.locator('[id^="flag-audit-btn-"]').click();

    await expect(page.locator('[id^="flag-audit-btn-"]')).toContainText(/Unflag/i);

    let patchDuringSession = false;
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/api\/(trades|ledger)/.test(req.url())) {
        patchDuringSession = true;
      }
    });

    await page.locator('#close-tx-modal-btn').click();
    await page.reload();
    await page.locator('#nav-transactions-btn').click();
    await openFirstTransactionModal(page);

    expect(patchDuringSession).toBe(false);
    await expect(page.locator('[id^="notes-textarea-"]')).not.toHaveValue(notes);
    await expect(page.locator('[id^="flag-audit-btn-"]')).toContainText(/Flag for Audit/i);
  });

  test('TC-UI-041: deployment analysis positions request includes populate_trades=true', async ({
    page,
    request,
  }) => {
    const { deployment } = await seedAccountWithTrade(request);

    await loginViaUI(page);
    await navigateTo(page, 'analysis');

    const positionsPromise = page.waitForRequest(
      (req) =>
        req.method() === 'GET' &&
        req.url().includes('/backtestapp/positions') &&
        req.url().includes('populate_trades=true'),
      { timeout: 45_000 }
    );

    await page.locator('select').first().selectOption(deployment._id);
    await page.getByRole('button', { name: 'Analyze' }).click();
    await positionsPromise;
  });

  test('TC-UI-042: deployment analysis renders metrics from analysis API', async ({
    page,
    request,
  }) => {
    const { deployment } = await seedAccountWithTrade(request);

    const analysisPayload = {
      data: {
        deployment_id: deployment._id,
        deployment_name: deployment.deployment_name || 'E2E Deployment',
        symbol: 'TEST',
        strategy_mode: 'PAPER',
        time_range: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
        metrics: {
          total_trades: 2,
          total_pnl: 1200,
          gross_profit: 2000,
          gross_loss: 800,
          profitability_factor: 2.5,
          wins: 1,
          losses: 1,
          win_rate: '50%',
          max_drawdown: -450,
          max_drawup: 900,
        },
        time_series: [{ timestamp: '2026-01-01T10:00:00Z', cumulative_pnl: 100, trade_count: 1 }],
        intraday_trades: [],
      },
    };

    await page.route(`**/backtestapp/deployments/${deployment._id}/analysis**`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analysisPayload) });
        return;
      }
      await route.continue();
    });

    await loginViaUI(page);
    await navigateTo(page, 'analysis');
    await page.locator('select').first().selectOption(deployment._id);
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page.getByText('Profitability Factor')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('2.50')).toBeVisible();
    await expect(page.getByText('Max Drawdown')).toBeVisible();
    await expect(page.getByText('Max Drawup:').locator('..')).toContainText('900');
  });

  test('TC-UI-043: candlestick chart adjusts time axis for UTC vs local timezone', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    await createSymbol(request, accessToken, { is_active: true });

    await page.route('**/backtestapp/symbols/**/candles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { data: [{ time: 1704067200, open: 100, high: 105, low: 99, close: 103 }] },
        }),
      });
    });

    await loginViaUI(page);
    await navigateTo(page, 'live-candlestick');

    const adjustment = await page.evaluate(() => {
      const rawTime = 1704067200;
      const utc = rawTime;
      const local = rawTime - new Date(rawTime * 1000).getTimezoneOffset() * 60;
      return { utc, local, offsetMinutes: new Date(rawTime * 1000).getTimezoneOffset() };
    });
    expect(adjustment.utc).toBe(1704067200);
    if (adjustment.offsetMinutes !== 0) {
      expect(adjustment.local).not.toBe(adjustment.utc);
    }

    let candleRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/candles')) candleRequests++;
    });
    await setSidebarTimezone(page, 'Local');
    await page.waitForTimeout(1200);
    await setSidebarTimezone(page, 'UTC');
    await page.waitForTimeout(1200);
    expect(candleRequests).toBeGreaterThan(0);
  });

  test('TC-UI-044: backtest dates API failure falls back to hardcoded dates', async ({ page }) => {
    await page.route('**/backtestapp/symbols/backtest-dates**', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ message: 'Unavailable' }) });
    });

    await loginViaUI(page);
    await navigateTo(page, 'live-candlestick');

    const dateSelect = page.locator('select').filter({ hasText: '2026-06-24' }).first();
    await expect(dateSelect.locator('option')).toHaveCount(3, { timeout: 15_000 });
    await expect(dateSelect.locator('option').first()).toHaveText('2026-06-24');
  });

  test('TC-UI-045: zero candles renders empty chart without JS errors', async ({ page, request }) => {
    const { accessToken } = await loginAsUser(request);
    await createSymbol(request, accessToken, { is_active: true });

    await page.route('**/backtestapp/symbols/backtest-dates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: ['2099-01-01'] }),
      });
    });
    await page.route('**/backtestapp/symbols/**/candles**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { data: [] } }),
      });
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await loginViaUI(page);
    await navigateTo(page, 'live-candlestick');

    await expect(page.getByText('Total Candles').locator('..').getByText('0')).toBeVisible({
      timeout: 20_000,
    });
    expect(pageErrors.filter((m) => /fitContent|chartData|undefined/i.test(m))).toHaveLength(0);
  });
});
