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

    async getSessions() {
      const res = await fetch(`${BASE_URL}/auth/sessions`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<any[]>(res);
    },

    async revokeSession(sessionId: string) {
      const res = await fetch(`${BASE_URL}/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ message: string }>(res);
    },

    async revokeOtherSessions() {
      const res = await fetch(`${BASE_URL}/auth/sessions/others`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ message: string }>(res);
    },

    async getApiKeys() {
      const res = await fetch(`${BASE_URL}/auth/api-keys`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<any[]>(res);
    },

    async createApiKey(name: string) {
      const res = await fetch(`${BASE_URL}/auth/api-keys`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      });
      return handleResponse<{ message: string; key: any }>(res);
    },

    async revokeApiKey(keyId: string) {
      const res = await fetch(`${BASE_URL}/auth/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: getHeaders(),
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

    async get(id: string) {
      const res = await fetch(`${BASE_URL}/accounts/${id}`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async create(accountData: { 
      account_name: string; 
      account_type: string; 
      initial_balance: number; 
      description?: string;
      commission_type?: 'PERCENTAGE' | 'FLAT';
      commission_rate?: number;
      broker_id?: string;
    }) {
      const res = await fetch(`${BASE_URL}/accounts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(accountData),
      });
      return handleResponse<{ data: any }>(res);
    },

    async update(id: string, updateData: { 
      account_name?: string; 
      description?: string; 
      is_active?: boolean;
      commission_type?: 'PERCENTAGE' | 'FLAT';
      commission_rate?: number;
      broker_id?: string;
    }) {
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

    async get(id: string) {
      const res = await fetch(`${BASE_URL}/symbols/${id}`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async create(symbolData: {
      symbol: string;
      exchange: string;
      instrument_token: string;
      symbol_name: string;
      description?: string;
      instrument_class?: string;
    }) {
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

    async get(id: string) {
      const res = await fetch(`${BASE_URL}/deployments/${id}`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
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
      backtest_date?: string;
      backtest_speed?: number;
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

    // Fetch all trades for a specific account (server-side filter — no false positives)
    async listForAccount(accountId: string) {
      const res = await fetch(`${BASE_URL}/trades?account_id=${encodeURIComponent(accountId)}&limit=500&order=desc`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    // Fetch all trades for a specific deployment (server-side filter)
    async listForDeployment(deploymentId: string) {
      const res = await fetch(`${BASE_URL}/trades?deployment_id=${encodeURIComponent(deploymentId)}&limit=500&order=desc`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    // Fetch all trades for a specific symbol (server-side filter)
    async listForSymbol(symbol: string) {
      const res = await fetch(`${BASE_URL}/trades?symbol=${encodeURIComponent(symbol)}&limit=500&order=desc`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    // Fetch trades using any combination of account, deployment/strategy, and symbol filters
    async listWithFilters(params: { account_id?: string; deployment_id?: string; symbol?: string; limit?: number }) {
      const query = new URLSearchParams();
      if (params.account_id) query.append('account_id', params.account_id);
      if (params.deployment_id) query.append('deployment_id', params.deployment_id);
      if (params.symbol) query.append('symbol', params.symbol);
      query.append('limit', String(params.limit || 500));
      query.append('order', 'desc');

      const res = await fetch(`${BASE_URL}/trades?${query.toString()}`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(tradeData: {
      account_id: string;
      symbol: string;
      price: number;
      quantity: number;
      type_of_order: 'BUY' | 'SELL';
      deployment_id?: string;
    }) {
      const res = await fetch(`${BASE_URL}/trades`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(tradeData),
      });
      return handleResponse<{ data: any; message: string }>(res);
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

    // Fetch ledger entries scoped to a specific account (server-side filter)
    async listForAccount(accountId: string) {
      const res = await fetch(`${BASE_URL}/ledger?accountId=${encodeURIComponent(accountId)}&limit=500&order=desc`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async deposit(accountId: string, amount: number, description?: string) {
      const res = await fetch(`${BASE_URL}/ledger/deposit`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ accountId, amount, description }),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async withdraw(accountId: string, amount: number, description?: string) {
      const res = await fetch(`${BASE_URL}/ledger/withdraw`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ accountId, amount, description }),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async transfer(fromAccountId: string, toAccountId: string, amount: number, description?: string) {
      const res = await fetch(`${BASE_URL}/ledger/transfer`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ fromAccountId, toAccountId, amount, description }),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },
  },

  // Brokers API
  brokers: {
    async list() {
      const res = await fetch(`${BASE_URL}/brokers`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(name: string) {
      const res = await fetch(`${BASE_URL}/brokers`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },
  },
};
