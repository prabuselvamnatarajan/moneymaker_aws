import { request as playwrightRequest } from '@playwright/test';
import { API_BASE, apiUrl, loginWithFallback, SEED_CREDENTIALS } from './fixtures/auth';

const API_BASE_URL = API_BASE;
const MAX_HEALTH_RETRIES = 60;
const HEALTH_INTERVAL_MS = 3000;

async function newApiContext() {
  return playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    ignoreHTTPSErrors: true,
  });
}

async function waitForHealth(): Promise<void> {
  const ctx = await newApiContext();
  try {
    for (let i = 0; i < MAX_HEALTH_RETRIES; i++) {
      try {
        // Relative path keeps /backtestapp prefix (leading / would hit host root)
        const res = await ctx.get(apiUrl('health'));
        if (res.ok()) {
          const body = await res.json();
          if (body.status === 'ok') return;
        }
      } catch {
        // stack not up yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    }
    console.warn(
      `[global-setup] /health not reachable at ${API_BASE_URL} — tests may fail without docker-compose`
    );
  } finally {
    await ctx.dispose();
  }
}

async function verifySeedUsers(): Promise<void> {
  const ctx = await newApiContext();
  try {
    for (const role of ['admin', 'user'] as const) {
      try {
        const tokens = await loginWithFallback(ctx, role);
        if (!tokens.accessToken) {
          console.warn(`[global-setup] Could not login as ${role}`);
        } else {
          console.log(`[global-setup] Seed login OK: ${tokens.email}`);
        }
      } catch (err) {
        console.warn(
          `[global-setup] Seed ${role} unavailable (tried ${SEED_CREDENTIALS[role].email} / ${SEED_CREDENTIALS[role].fallbackEmail}):`,
          err
        );
      }
    }
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForHealth();
  await verifySeedUsers();
}
