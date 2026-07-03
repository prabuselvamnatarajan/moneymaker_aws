/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const BASE_URL = '/backtestapp';

// Helper to get authorization headers
function getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('accessToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

// Global handle response wrapper
async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    // Session expired or invalid
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    // We can dispatch a custom event or reload to trigger login redirect
    window.dispatchEvent(new Event('auth-unauthorized'));
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || 'Unauthorized');
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP error! status: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Auth API
  auth: {
    async login(email: string, password: string) {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await handleResponse<{ accessToken?: string; refreshToken?: string; mfaRequired?: boolean }>(res);
      if (data.accessToken && data.refreshToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      return data;
    },

    async signup(name: string, email: string, username: string, password: string) {
      const res = await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, username, password }),
      });
      await handleResponse<{ message: string }>(res);
      return this.login(email, password);
    },

    async logout() {
      try {
        await fetch(`${BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: getHeaders(),
        });
      } finally {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
    },

    async getMe() {
      const res = await fetch(`${BASE_URL}/me`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ data: { _id: string; username: string; email: string; name: string; is_mfa_enabled: boolean; backup_codes?: string[] } }>(res);
    },

    async changePassword(currentPassword: string, newPassword: string) {
      const res = await fetch(`${BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      return handleResponse<{ message: string }>(res);
    },
  },

  // MFA API
  mfa: {
    async setup() {
      const res = await fetch(`${BASE_URL}/auth/mfa/setup`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ otpauthUrl: string; qrCodeDataUrl: string; tempSecret: string }>(res);
    },

    async verifySetup(token: string) {
      const res = await fetch(`${BASE_URL}/auth/mfa/verify-setup`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ token }),
      });
      return handleResponse<{ message: string }>(res);
    },

    async disable() {
      const res = await fetch(`${BASE_URL}/auth/mfa/disable`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ message: string }>(res);
    },

    async loginVerify(email: string, password: string, token: string) {
      const res = await fetch(`${BASE_URL}/auth/mfa/login-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, token }),
      });
      const data = await handleResponse<{ accessToken: string; refreshToken: string }>(res);
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return data;
    },
  },

  // Accounts API
  accounts: {
    async list() {
      const res = await fetch(`${BASE_URL}/accounts?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(accountData: { account_name: string; account_type: string; initial_balance: number; description?: string }) {
      const res = await fetch(`${BASE_URL}/accounts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(accountData),
      });
      return handleResponse<{ data: any }>(res);
    },

    async update(id: string, updateData: { account_name?: string; description?: string; is_active?: boolean }) {
      const res = await fetch(`${BASE_URL}/accounts/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(updateData),
      });
      return handleResponse<{ data: any }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/accounts/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },
  },

  // Symbols API
  symbols: {
    async list() {
      const res = await fetch(`${BASE_URL}/symbols?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(symbolData: { symbol: string; exchange: string; instrument_token: string }) {
      const res = await fetch(`${BASE_URL}/symbols`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(symbolData),
      });
      return handleResponse<{ data: any }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/symbols/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },
  },

  // Strategies API
  strategies: {
    async list() {
      const res = await fetch(`${BASE_URL}/strategies?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(strategyData: { strategy_name: string; strategy_description: string }) {
      const res = await fetch(`${BASE_URL}/strategies`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(strategyData),
      });
      return handleResponse<{ data: any }>(res);
    },
  },

  // Deployments API
  deployments: {
    async list() {
      const res = await fetch(`${BASE_URL}/deployments?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(deploymentData: {
      strategy_id: string;
      account_id: string;
      user_symbol_id: string;
      instrument_token: string;
      symbol: string;
      start_time: string;
      current_status: string;
      strategy_mode: string;
      deployment_name?: string;
      notes?: string;
    }) {
      const res = await fetch(`${BASE_URL}/deployments`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(deploymentData),
      });
      return handleResponse<{ data: any }>(res);
    },

    async getMetrics(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}/metrics`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{
        deployment_id: string;
        current_status: string;
        total_trades: number;
        total_pnl: number;
        wins: number;
        losses: number;
        win_rate: string;
      }>(res);
    },

    async start(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}/start`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async stop(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}/stop`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async pause(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}/pause`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async resume(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}/resume`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },
  },

  // Trades API
  trades: {
    async list() {
      const res = await fetch(`${BASE_URL}/trades?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },
  },

  // Ledger API
  ledger: {
    async list() {
      const res = await fetch(`${BASE_URL}/ledger?limit=100`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },
  },
};
