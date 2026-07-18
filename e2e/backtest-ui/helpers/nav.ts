import type { Page } from '@playwright/test';
import { loginWithFallback, SEED_CREDENTIALS } from '../../fixtures/auth';

export async function loginViaUI(page: Page, role: 'admin' | 'user' = 'user'): Promise<void> {
  const creds = SEED_CREDENTIALS[role];
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.fill(creds.email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(creds.password);

  const submitBtn = page.locator('button[type="submit"]').first();
  const loginResponse = page.waitForResponse(
    (r) => r.url().includes('/auth/login') && r.request().method() === 'POST',
    { timeout: 30_000 }
  ).catch(() => null);

  await submitBtn.click();
  const res = await loginResponse;

  if (res && !res.ok()) {
    // Try fallback credentials (cobratrades)
    await emailInput.fill(creds.fallbackEmail);
    await passwordInput.fill(creds.fallbackPassword);
    await submitBtn.click();
  }

  // Handle MFA setup skip or verify screens
  const skipBtn = page.getByRole('button', { name: /skip for now/i });
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skipBtn.click();
  }

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
  await section.getByRole('button', { name: pattern }).click();
  await section.getByRole('button', { name: 'Overview', exact: true }).click();
}

export async function openAccountDetail(page: Page, accountId: string): Promise<void> {
  await page.locator(`#sidebar-acc-${accountId}`).click();
}

export async function openProfile(page: Page): Promise<void> {
  await page.locator('#sidebar-container').locator('button').filter({ hasText: '@' }).click();
  await page.getByRole('heading', { name: 'Operator Profile & Security Center' }).waitFor({
    timeout: 15_000,
  });
}

export async function setSidebarTimezone(page: Page, mode: 'UTC' | 'Local'): Promise<void> {
  await page.locator('#sidebar-container').getByRole('button', { name: mode === 'UTC' ? 'UTC' : 'LOC' }).click();
}

export async function navigateToStrategies(page: Page): Promise<void> {
  const deployTrigger = page.locator('#btn-deploy-strategy-trigger');
  if (await deployTrigger.isVisible().catch(() => false)) {
    return;
  }
  await page.getByRole('button', { name: /Deployments \(\d+\)/ }).click();
  await page
    .locator('button')
    .filter({ hasText: /^Deployments \(\d+\)$/ })
    .locator('xpath=following-sibling::div[1]')
    .getByRole('button', { name: 'Overview' })
    .click();
  await deployTrigger.waitFor({ timeout: 15_000 });
}

export async function navigateToSymbols(page: Page): Promise<void> {
  const trackBtn = page.locator('#btn-track-symbol-trigger');
  if (await trackBtn.isVisible().catch(() => false)) {
    return;
  }
  await page.getByRole('button', { name: /Symbols \(\d+\)/ }).click();
  await page
    .locator('button')
    .filter({ hasText: /^Symbols \(\d+\)$/ })
    .locator('xpath=following-sibling::div[1]')
    .getByRole('button', { name: 'Overview' })
    .click();
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
