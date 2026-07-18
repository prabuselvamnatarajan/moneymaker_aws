import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost/backtestapp';
const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost/backtest-ui/';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60_000,
  globalSetup: require.resolve('./global-setup.ts'),
  globalTeardown: require.resolve('./global-teardown.ts'),
  use: {
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'api',
      testDir: './backtest-app',
      use: {
        baseURL: API_BASE_URL,
      },
    },
    {
      name: 'ui',
      testDir: './backtest-ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: UI_BASE_URL,
      },
    },
    {
      name: 'api-no-secrets',
      testDir: './backtest-app',
      testMatch: /iam-auth\.spec\.ts/,
      grep: /@no-secrets/,
      use: {
        baseURL: process.env.API_NO_SECRETS_BASE_URL || API_BASE_URL,
      },
    },
    {
      name: 'slow',
      testDir: '.',
      grep: /@slow/,
      timeout: 120_000,
      use: {
        baseURL: API_BASE_URL,
      },
    },
  ],
});
