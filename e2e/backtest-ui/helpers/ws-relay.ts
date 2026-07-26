import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const WS_URL_PATTERN = /\/backtestapp\/ws/;

/** Playwright WebSocket relay with server→client push for E2E ticker/event tests. */
export class WsRelay {
  private pushFn: ((msg: string) => void) | null = null;

  isReady(): boolean {
    return this.pushFn != null;
  }

  async install(
    page: Page,
    opts: { injectAfterMs?: number; closeAfterMs?: number } = {}
  ): Promise<void> {
    await page.routeWebSocket(WS_URL_PATTERN, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => ws.send(message));
      ws.onMessage((message) => server.send(message));
      this.pushFn = (msg: string) => ws.send(msg);

      if (opts.injectAfterMs != null) {
        setTimeout(() => {
          this.push({ event: 'broker_updated', broker_id: 'e2e-broker' });
        }, opts.injectAfterMs);
      }

      if (opts.closeAfterMs != null) {
        setTimeout(() => ws.close(), opts.closeAfterMs);
      }
    });
  }

  push(payload: string | Record<string, unknown>): void {
    if (!this.pushFn) {
      throw new Error('WS relay not connected — call waitForConnection after login');
    }
    this.pushFn(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  async waitForConnection(page: Page): Promise<void> {
    await page.waitForEvent('websocket', {
      predicate: (ws) => WS_URL_PATTERN.test(ws.url()),
      timeout: 30_000,
    });
    await expect
      .poll(() => this.isReady(), { timeout: 5_000, intervals: [100, 200, 500] })
      .toBe(true);
  }
}
