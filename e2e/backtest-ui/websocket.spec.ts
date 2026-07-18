import { expect, test, type Page } from '@playwright/test';
import { apiRequest } from '../fixtures/auth';
import {
  getLocalStorageTokens,
  loginViaUI,
  logoutViaUI,
  navigateToSymbols,
} from './helpers/nav';

const WS_URL_PATTERN = /\/backtestapp\/ws/;

function trackAppWebSockets(page: Page): { urls: string[]; count: () => number } {
  const urls: string[] = [];
  page.on('websocket', (ws) => {
    if (WS_URL_PATTERN.test(ws.url())) {
      urls.push(ws.url());
    }
  });
  return { urls, count: () => urls.length };
}

async function installWsRelay(
  page: Page,
  opts: { injectAfterMs?: number; closeAfterMs?: number } = {}
): Promise<void> {
  await page.routeWebSocket(WS_URL_PATTERN, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => server.send(message));

    if (opts.injectAfterMs != null) {
      setTimeout(() => {
        ws.send(JSON.stringify({ event: 'broker_updated', broker_id: 'e2e-broker' }));
      }, opts.injectAfterMs);
    }

    if (opts.closeAfterMs != null) {
      setTimeout(() => ws.close(), opts.closeAfterMs);
    }
  });
}

async function sendWsFrame(page: Page, payload: string, delayMs = 300): Promise<void> {
  await page.evaluate(
    ({ frame, waitMs }) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const ws = (window as unknown as { __e2eWs?: WebSocket }).__e2eWs;
          if (ws?.onmessage) {
            ws.onmessage({ data: frame } as MessageEvent);
          }
          resolve();
        }, waitMs);
      }),
    { frame: payload, waitMs: delayMs }
  );
}

async function hookClientWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/backtestapp/ws')) {
          (window as unknown as { __e2eWs?: WebSocket }).__e2eWs = this;
        }
      }
    } as typeof WebSocket;
  });
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
    await hookClientWebSocket(page);
    await installWsRelay(page);
    await loginViaUI(page);
    await page.waitForLoadState('networkidle');

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
        response.url().includes('/api/accounts') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 20_000 }
    );

    await sendWsFrame(
      page,
      JSON.stringify({ event: 'broker_updated', broker_id: 'e2e-broker' }),
      0
    );

    const [detail] = await Promise.all([brokerEvent, accountsReload]);
    expect(detail.event).toBe('broker_updated');
  });

  test('TC-UI-020: instrument_token tick updates only the matching symbol lastPrice', async ({
    page,
    request,
  }) => {
    await hookClientWebSocket(page);
    await installWsRelay(page);
    await loginViaUI(page);
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

    const target = items[0];
    const other = items[1];
    const newPrice = 4242.42;

    const priceCell = (symbol: string) =>
      page
        .locator('tbody tr')
        .filter({ has: page.locator('span.font-mono', { hasText: symbol }) })
        .locator('td')
        .nth(4);

    const targetBefore = await priceCell(target.symbol).innerText();
    const otherBefore = await priceCell(other.symbol).innerText();

    await sendWsFrame(
      page,
      JSON.stringify({ instrument_token: target.instrument_token, last_price: newPrice })
    );

    await expect(priceCell(target.symbol)).not.toHaveText(targetBefore, { timeout: 10_000 });
    await expect(priceCell(target.symbol)).toContainText('4,242.42');
    await expect(priceCell(other.symbol)).toHaveText(otherBefore);
  });

  test('TC-UI-021: malformed WS JSON is logged without crashing the UI or connection', async ({
    page,
  }) => {
    await hookClientWebSocket(page);
    await installWsRelay(page);
    await loginViaUI(page);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await sendWsFrame(page, 'not-valid-json{{{');
    await expect(page.locator('#nav-dashboard-btn, #sidebar-container').first()).toBeVisible();

    expect(consoleErrors.some((line) => /Error parsing live WS message/i.test(line))).toBe(true);

    await sendWsFrame(
      page,
      JSON.stringify({ instrument_token: 'e2e-health-check-token', last_price: 100 })
    );
    await expect(page.locator('#nav-dashboard-btn, #sidebar-container').first()).toBeVisible();
  });

  test('TC-UI-022: WebSocket disconnect auto-reconnects after ~3s with a fresh connection', async ({
    page,
  }) => {
    const tracker = trackAppWebSockets(page);
    await page.routeWebSocket(WS_URL_PATTERN, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => server.send(message));
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
      server.onMessage((message) => server.send(message));
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
