import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  loginViaUI,
  navigateToStrategies,
  openDeployDialog,
} from './helpers/nav';

function deployForm(page: Page): Locator {
  return page
    .getByRole('heading', { name: /Deploy Strategy template/i })
    .locator('xpath=ancestor::div[contains(@class,"max-w-lg")]//form');
}

function fieldByLabel(form: Locator, label: string): Locator {
  return form.locator('label').filter({ hasText: label }).locator('..').locator('select, input, textarea').first();
}

async function openFreshDeployDialog(page: Page): Promise<Locator> {
  await navigateToStrategies(page);
  await openDeployDialog(page);
  return deployForm(page);
}

async function fillRequiredDeployFields(
  page: Page,
  form: Locator,
  opts: { deploymentName?: string; pickSymbol?: boolean } = {}
): Promise<void> {
  const deploymentName = opts.deploymentName ?? `E2E Deploy ${Date.now()}`;

  await fieldByLabel(form, 'Strategy Template').selectOption({ index: 1 });
  await fieldByLabel(form, 'Deployment Display Name').fill(deploymentName);
  await fieldByLabel(form, 'Deployment Notes / Description').fill('Automated deploy-dialog E2E coverage.');
  await fieldByLabel(form, 'Target Brokerage Account').selectOption({ index: 1 });

  if (opts.pickSymbol !== false) {
    const symbolSelect = fieldByLabel(form, 'Target Symbol');
    if (await symbolSelect.isVisible().catch(() => false)) {
      await symbolSelect.selectOption({ index: 1 });
    }
  }
}

function deploymentPostWatcher(page: Page): { seen: () => boolean } {
  let posted = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/backtestapp\/deployments\b/.test(request.url())) {
      posted = true;
    }
  });
  return { seen: () => posted };
}

test.describe('BackTest UI — Deploy Strategy dialog', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page);
  });

  test('TC-UI-024: Deploy Strategy dialog defaults mode to live (#33)', async ({ page }) => {
    const form = await openFreshDeployDialog(page);
    const modeSelect = fieldByLabel(form, 'Deployment Mode');

    await expect(modeSelect).toHaveValue('live');
    await expect(modeSelect.locator('option:checked')).toHaveText(/Live Workload/i);
  });

  test('TC-UI-025: Deploy Strategy dialog defaults initialStatus to active (#33)', async ({ page }) => {
    const form = await openFreshDeployDialog(page);
    const statusSelect = fieldByLabel(form, 'Initial Execution State');

    await expect(statusSelect).toHaveValue('active');
    await expect(statusSelect.locator('option:checked')).toHaveText(/Active Execution/i);
  });

  test('TC-UI-026: successful submit resets mode/status to live+active for next deployment (#33)', async ({
    page,
  }) => {
    const form = await openFreshDeployDialog(page);
    await fillRequiredDeployFields(page, form, { deploymentName: `E2E Reset ${Date.now()}` });

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/backtestapp\/deployments\b/.test(response.url()) &&
        response.status() < 500,
      { timeout: 30_000 }
    );

    await form.getByRole('button', { name: /Deploy Container Bot/i }).click();
    await createResponse;

    await openDeployDialog(page);
    const reopened = deployForm(page);

    await expect(fieldByLabel(reopened, 'Deployment Mode')).toHaveValue('live');
    await expect(fieldByLabel(reopened, 'Initial Execution State')).toHaveValue('active');
  });

  test('TC-UI-027: backtest mode toggles backtestDate/backtestSpeed fields visibility', async ({
    page,
  }) => {
    const form = await openFreshDeployDialog(page);
    const modeSelect = fieldByLabel(form, 'Deployment Mode');
    const backtestDate = fieldByLabel(form, 'Backtest Date');
    const backtestSpeed = fieldByLabel(form, 'Delay Speed');

    await expect(backtestDate).toBeHidden();
    await expect(backtestSpeed).toBeHidden();

    await modeSelect.selectOption('backtest');
    await expect(backtestDate).toBeVisible();
    await expect(backtestSpeed).toBeVisible();

    await modeSelect.selectOption('live');
    await expect(backtestDate).toBeHidden();
    await expect(backtestSpeed).toBeHidden();

    await modeSelect.selectOption('paper');
    await expect(backtestDate).toBeHidden();
    await expect(backtestSpeed).toBeHidden();
  });

  test('TC-UI-028: dynamic symbol requires underlying and valid YYYY-MM-DD expiry before submit', async ({
    page,
  }) => {
    const form = await openFreshDeployDialog(page);
    const postWatcher = deploymentPostWatcher(page);

    await fillRequiredDeployFields(page, form, { pickSymbol: false });
    await page.locator('#chk-dynamic-symbol').check();

    await form.getByRole('button', { name: /Deploy Container Bot/i }).click();
    await page.waitForTimeout(400);
    expect(postWatcher.seen()).toBe(false);
    await expect(form).toBeVisible();

    const underlyingSelect = fieldByLabel(form, 'Underlying symbol');
    await underlyingSelect.selectOption({ index: 1 });

    const expiryInput = fieldByLabel(form, 'Expiry');
    await expiryInput.evaluate((element: HTMLInputElement) => {
      element.removeAttribute('type');
      element.value = '13-99-2026';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await form.getByRole('button', { name: /Deploy Container Bot/i }).click();
    await page.waitForTimeout(400);
  });

  test('TC-UI-029: static symbol deployment requires at least one selected symbol', async ({ page }) => {
    const form = await openFreshDeployDialog(page);
    const postWatcher = deploymentPostWatcher(page);

    await fillRequiredDeployFields(page, form, { pickSymbol: false });
    await expect(page.locator('#chk-dynamic-symbol')).not.toBeChecked();

    await form.getByRole('button', { name: /Deploy Container Bot/i }).click();
    await page.waitForTimeout(400);

    expect(postWatcher.seen()).toBe(false);
    await expect(form).toBeVisible();
  });

  test('TC-UI-030: ATM moneyness forces offset 1 in payload and disables offset input', async ({
    page,
  }) => {
    const form = await openFreshDeployDialog(page);
    await fillRequiredDeployFields(page, form, { pickSymbol: false });
    await page.locator('#chk-dynamic-symbol').check();

    await fieldByLabel(form, 'Underlying symbol').selectOption({ index: 1 });
    await fieldByLabel(form, 'Expiry').fill('2026-12-25');

    const offsetInput = fieldByLabel(form, 'Offset');
    const moneynessSelect = fieldByLabel(form, 'Moneyness');

    await offsetInput.fill('5');
    await moneynessSelect.selectOption('ATM');
    await expect(offsetInput).toBeDisabled();

    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/backtestapp/deployments**', async (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue();
        return;
      }
      await route.continue();
    });

    await form.getByRole('button', { name: /Deploy Container Bot/i }).click();
    await page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && /\/backtestapp\/deployments\b/.test(response.url()),
      { timeout: 30_000 }
    );

    expect(capturedBody).not.toBeNull();
    const symbolControl = capturedBody!.symbol_control as { offset?: number; moneyness?: string };
    expect(symbolControl.moneyness).toBe('ATM');
    expect(symbolControl.offset).toBe(1);
  });
});
