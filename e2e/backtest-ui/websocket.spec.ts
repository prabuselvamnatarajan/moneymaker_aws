import { expect, test, type Page } from '@playwright/test';
import { apiRequest } from '../fixtures/auth';
import {
  getLocalStorageTokens,
  loginViaUI,
  logoutViaUI,
  navigateToSymbols,
} from './helpers/nav';
import { WS_URL_PATTERN, WsRelay } from './helpers/ws-relay';

function trackAppWebSockets(page: Page): { urls: string[]; count: () => number } {
  const urls: string[] = [];
  page.on('websocket', (ws) => {
    if (WS_URL_PATTERN.test(ws.url())) {
      urls.push(ws.url());
    }
  });
  return { urls, count: () => urls.length };
}

test.describe('BackTest UI — Live WebSocket ticker feed', () => {
  test('TC-UI-018: authenticated session opens /backtestapp/ws with protocol-matched token URL', async ({
    page,
  }) => {
    const wsPromise = page.waitForEvent('websocket', {
      predicate: (ws) => WS_URL_PATTERN.test(ws.url()),
      timeout: 30_000,
    });

    await loginViaUI(page);
    const ws = await wsPromise;
    const wsUrl = ws.url();

    expect(wsUrl).toContain('/backtestapp/ws?token=');

    const pageProtocol = new URL(page.url()).protocol;
    const expectedProto = pageProtocol === 'https:' ? 'wss:' : 'ws:';
    expect(wsUrl.startsWith(`${expectedProto}//`)).toBe(true);

    const { accessToken } = await getLocalStorageTokens(page);
    expect(accessToken).toBeTruthy();
    expect(decodeURIComponent(wsUrl.split('token=')[1] ?? '')).toBe(accessToken);
  });

  test('TC-UI-019: broker_updated WS event dispatches broker-updated and reloads data', async ({
    page,
  }) => {
    const relay = new WsRelay();
    await relay.install(page);

    const wsReady = page.waitForEvent('websocket', {
      predicate: (ws) => WS_URL_PATTERN.test(ws.url()),
      timeout: 30_000,
    });

    await loginViaUI(page);
    await wsReady;
    await expect.poll(() => relay.isReady(), { timeout: 5_000 }).toBe(true);

    const brokerEvent = page.evaluate(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          window.addEventListener(
            'broker-updated',
            (event) => resolve((event as CustomEvent).detail as Record<string, unknown>),
            { once: true }
          );
        })
    );

    const accountsReload = page.waitForResponse(
      (response) =>
        response.url().includes('/backtestapp/accounts') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 20_000 }
    );

    relay.push({ event: 'broker_updated', broker_id: 'e2e-broker' });

    const [detail] = await Promise.all([brokerEvent, accountsReload]);
    expect(detail.event).toBe('broker_updated');
  });

  test('TC-UI-020: instrument_token tick updates only the matching symbol lastPrice', async ({
    page,
    request,
  }) => {
    const relay = new WsRelay();
    await relay.install(page);
    const wsReady = page.waitForEvent('websocket', {
      predicate: (ws) => WS_URL_PATTERN.test(ws.url()),
      timeout: 30_000,
    });
    await loginViaUI(page);
    await wsReady;
    await expect.poll(() => relay.isReady(), { timeout: 5_000 }).toBe(true);
    await navigateToSymbols(page);

    const { accessToken } = await getLocalStorageTokens(page);
    const symbolsRes = await apiRequest(request, accessToken!).get('/symbols');
    expect(symbolsRes.ok()).toBe(true);
    const symbolsBody = await symbolsRes.json();
    const items = (symbolsBody.items ?? symbolsBody.data ?? symbolsBody) as Array<{
      symbol: string;
      instrument_token: string;
    }>;
    expect(items.length).toBeGreaterThan(1);

    const firstTicker = (
      await page.locator('tbody tr').first().locator('span.font-mono').first().innerText()
    ).trim();
    const target = items.find((s) => s.symbol === firstTicker) ?? items[0];
    const other = items.find((s) => s.symbol !== target.symbol) ?? items[1];
    const newPrice = 4242.42;

    const priceCell = (symbol: string) =>
      page
        .locator('tbody tr')
        .filter({ has: page.locator('span.font-mono', { hasText: symbol }) })
        .locator('td')
        .nth(5);

    const targetBefore = await priceCell(target.symbol).innerText();
    const otherBefore = await priceCell(other.symbol).innerText();

    relay.push({ instrument_token: target.instrument_token, last_price: newPrice });

    await expect(priceCell(target.symbol)).toContainText('₹4,242.42', { timeout: 10_000 });
    await expect(priceCell(target.symbol)).not.toHaveText(targetBefore);
    await expect(priceCell(other.symbol)).toHaveText(otherBefore);
  });

  test('TC-UI-021: malformed WS JSON is logged without crashing the UI or connection', async ({
    page,
  }) => {
    const relay = new WsRelay();
    await relay.install(page);

    const consoleLines: string[] = [];
    page.on('console', (msg) => {
      consoleLines.push(msg.text());
    });

    const wsReady = page.waitForEvent('websocket', {
      predicate: (ws) => WS_URL_PATTERN.test(ws.url()),
      timeout: 30_000,
    });
    await loginViaUI(page);
    await wsReady;
    await expect.poll(() => relay.isReady(), { timeout: 5_000 }).toBe(true);

    relay.push('not-valid-json{{{');
    await expect(page.locator('#nav-dashboard-btn, #sidebar-container').first()).toBeVisible();

    expect(consoleLines.some((line) => /Error parsing live WS message/i.test(line))).toBe(true);

    relay.push({ instrument_token: 'e2e-health-check-token', last_price: 100 });
    await expect(page.locator('#nav-dashboard-btn, #sidebar-container').first()).toBeVisible();
  });

  test('TC-UI-022: WebSocket disconnect auto-reconnects after ~3s with a fresh connection', async ({
    page,
  }) => {
    const tracker = trackAppWebSockets(page);
    await page.routeWebSocket(WS_URL_PATTERN, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => ws.send(message));
      ws.onMessage((message) => server.send(message));
      setTimeout(() => ws.close(), 500);
    });

    await loginViaUI(page);
    await expect.poll(() => tracker.count(), { timeout: 5_000 }).toBeGreaterThanOrEqual(1);

    await expect
      .poll(() => tracker.count(), { timeout: 10_000, intervals: [500, 1000] })
      .toBeGreaterThanOrEqual(2);

    const firstToken = decodeURIComponent(tracker.urls[0].split('token=')[1] ?? '');
    const secondToken = decodeURIComponent(tracker.urls[1].split('token=')[1] ?? '');
    expect(firstToken).toBeTruthy();
    expect(secondToken).toBeTruthy();
  });

  test('TC-UI-023: logout disposes WebSocket and suppresses reconnect loop', async ({ page }) => {
    const tracker = trackAppWebSockets(page);
    await page.routeWebSocket(WS_URL_PATTERN, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => ws.send(message));
      ws.onMessage((message) => server.send(message));
      setTimeout(() => ws.close(), 500);
    });

    await loginViaUI(page);
    await expect.poll(() => tracker.count()).toBeGreaterThanOrEqual(1);

    await logoutViaUI(page);
    const countAfterLogout = tracker.count();
    await page.waitForTimeout(4500);

    expect(tracker.count()).toBe(countAfterLogout);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
  });
});
