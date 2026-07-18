import { request as playwrightRequest } from '@playwright/test';
import { loginAs, SEED_CREDENTIALS } from './fixtures/auth';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost/backtestapp';
const MAX_HEALTH_RETRIES = 60;
const HEALTH_INTERVAL_MS = 3000;

async function waitForHealth(): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  try {
    for (let i = 0; i < MAX_HEALTH_RETRIES; i++) {
      try {
        const res = await ctx.get('/health');
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
  const ctx = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  try {
    for (const creds of [SEED_CREDENTIALS.admin, SEED_CREDENTIALS.user]) {
      try {
        const tokens = await loginAs(ctx, creds.email, creds.password);
        if (!tokens.accessToken) {
          console.warn(`[global-setup] Could not login as ${creds.email}`);
        }
      } catch (err) {
        console.warn(`[global-setup] Seed user ${creds.email} unavailable:`, err);
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
