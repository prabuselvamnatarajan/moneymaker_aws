import type { Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { API_BASE, loginWithFallback } from '../../fixtures/auth';

export async function loginViaUI(page: Page, role: 'admin' | 'user' = 'user'): Promise<void> {
  await page.goto('.');
  await page.evaluate(() => localStorage.clear());

  const api = await playwrightRequest.newContext({ baseURL: API_BASE });
  try {
    const { accessToken, refreshToken } = await loginWithFallback(api, role);
    await setLocalStorageToken(page, accessToken, refreshToken);
  } finally {
    await api.dispose();
  }
  await page.goto('.');
  await page.waitForLoadState('domcontentloaded');
  await page
    .waitForResponse(
      (r) => r.url().includes('/backtestapp/brokers') && r.request().method() === 'GET' && r.ok(),
      { timeout: 30_000 }
    )
    .catch(() => null);

  await page.locator('#sidebar-container, #nav-dashboard-btn').first().waitFor({
    timeout: 30_000,
  });
}

export async function navigateTo(page: Page, screen: 'dashboard' | 'transactions' | 'brokers' | 'analysis' | 'live-candlestick') {
  const map: Record<string, string> = {
    dashboard: '#nav-dashboard-btn',
    transactions: '#nav-transactions-btn',
    brokers: '#nav-brokers-btn',
    analysis: '#nav-analysis-btn',
    'live-candlestick': '#nav-live-candlestick-btn',
  };
  await page.locator(map[screen]).click();
}

const resourceSectionPattern: Record<'accounts' | 'symbols' | 'deployments' | 'templates', RegExp> = {
  accounts: /^Accounts \(/,
  symbols: /^Tracked Symbols \(/,
  deployments: /^Deployments \(/,
  templates: /^Strategy Templates \(/,
};

export async function openResourceOverview(
  page: Page,
  resource: 'accounts' | 'symbols' | 'deployments' | 'templates'
): Promise<void> {
  const pattern = resourceSectionPattern[resource];
  const section = page.locator('#sidebar-container').locator('div.space-y-1').filter({
    has: page.getByRole('button', { name: pattern }),
  });
  const overviewBtn = section.getByRole('button', { name: 'Overview', exact: true });

  if (!(await overviewBtn.isVisible().catch(() => false))) {
    await section.getByRole('button', { name: pattern }).click();
    await page.waitForTimeout(350);
  }
  if (!(await overviewBtn.isVisible().catch(() => false))) {
    await section.getByRole('button', { name: pattern }).click();
    await page.waitForTimeout(350);
  }
  await overviewBtn.evaluate((el: HTMLElement) => el.click());
}

export async function openAccountDetail(
  page: Page,
  accountId: string,
  accountName?: string
): Promise<void> {
  if (!accountName) {
    throw new Error('openAccountDetail requires accountName for reliable navigation');
  }

  await openResourceOverview(page, 'accounts');

  const search = page.locator('input[placeholder*="Search accounts"]');
  if (await search.isVisible().catch(() => false)) {
    await search.fill(accountName);
  }

  await page.getByText(accountName, { exact: true }).first().click();
  await page.getByRole('heading', { name: accountName }).waitFor({ timeout: 15_000 });
}

export async function openProfile(page: Page): Promise<void> {
  await page.locator('#sidebar-container').locator('button').filter({ hasText: '@' }).first().click();
  await page.getByRole('heading', { name: 'Operator Profile & Security Center' }).waitFor({
    timeout: 15_000,
  });
}

export async function setSidebarTimezone(page: Page, mode: 'UTC' | 'Local'): Promise<void> {
  await page.locator('#sidebar-container').getByRole('button', { name: mode === 'UTC' ? 'UTC' : 'LOC', exact: true }).first().click();
}

export async function navigateToStrategies(page: Page): Promise<void> {
  const deployTrigger = page.locator('#btn-deploy-strategy-trigger');
  if (await deployTrigger.isVisible().catch(() => false)) {
    return;
  }
  await openResourceOverview(page, 'deployments');
  await deployTrigger.waitFor({ timeout: 15_000 });
}

export async function navigateToSymbols(page: Page): Promise<void> {
  const trackBtn = page.locator('#btn-track-symbol-trigger');
  if (await trackBtn.isVisible().catch(() => false)) {
    return;
  }
  await openResourceOverview(page, 'symbols');
  await trackBtn.waitFor({ timeout: 15_000 });
}

export async function navigateToProfile(page: Page): Promise<void> {
  await page.locator('#sidebar-container button').filter({ hasText: /@/ }).first().click();
  await page.getByRole('button', { name: /Sign Out Session/i }).waitFor({ timeout: 15_000 });
}

export async function logoutViaUI(page: Page): Promise<void> {
  await navigateToProfile(page);
  await page.getByRole('button', { name: /Sign Out Session/i }).click();
  await page.locator('input[type="email"], input[name="email"]').first().waitFor({ timeout: 15_000 });
}

export async function openDeployDialog(page: Page): Promise<void> {
  await page.locator('#btn-deploy-strategy-trigger').click();
  await page.getByRole('heading', { name: /Deploy Strategy template/i }).waitFor({ timeout: 10_000 });
}

export async function openRegisterAccountDialog(page: Page): Promise<void> {
  await page.locator('#btn-register-account-trigger').click();
}

export function accountRegistrationModal(page: Page) {
  return page.locator('.fixed.inset-0').filter({ hasText: 'Register New Brokerage' });
}

export async function getLocalStorageTokens(page: Page) {
  return page.evaluate(() => ({
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  }));
}

export async function setLocalStorageToken(page: Page, accessToken: string, refreshToken?: string) {
  await page.evaluate(
    ({ access, refresh }) => {
      localStorage.setItem('accessToken', access);
      if (refresh) localStorage.setItem('refreshToken', refresh);
    },
    { access: accessToken, refresh: refreshToken || '' }
  );
}
