/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const BASE_URL = '/backtestapp';

// Custom authentication error class to identify session invalidation/expiration
export class AuthError extends Error {
  isAuthError = true;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Global fetch interceptor for token refresh
const originalFetch = window.fetch;
let refreshPromise: Promise<string> | null = null;

window.fetch = async function (input, init) {
  let res = await originalFetch(input, init);

  if (res.status === 401) {
    const urlString = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url || '');
    if (
      !urlString.includes('/auth/refresh-token') &&
      !urlString.includes('/auth/login') &&
      !urlString.includes('/auth/signup') &&
      !urlString.includes('/auth/mfa/login-verify')
    ) {
      try {
        console.log('[Auth Interceptor] 401 detected, attempting to refresh token...');
        
        // Deduplicate concurrent refresh requests
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const refreshToken = localStorage.getItem('refreshToken');
            if (!refreshToken) throw new AuthError('No refresh token available');
            
            let refreshRes: Response;
            try {
              refreshRes = await originalFetch(`${BASE_URL}/auth/refresh-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
              });
            } catch (networkErr) {
              console.error('[Auth Interceptor] Network error during refresh:', networkErr);
              throw networkErr; // Propagate network error, do NOT throw AuthError
            }
            
            if (refreshRes.status === 401 || refreshRes.status === 403 || refreshRes.status === 400) {
              throw new AuthError(`Session expired with status: ${refreshRes.status}`);
            }
            
            if (!refreshRes.ok) {
              throw new Error(`Refresh token request failed with status: ${refreshRes.status}`);
            }
            
            const data = await refreshRes.json() as { accessToken: string };
            if (!data.accessToken) {
              throw new Error('No access token in refresh response');
            }
            
            localStorage.setItem('accessToken', data.accessToken);
            return data.accessToken;
          })();
        }
        
        const newAccessToken = await refreshPromise;
        refreshPromise = null;
        
        // Clone init to update Authorization header
        const newInit = { ...(init || {}) };
        const headers = { ...(newInit.headers || {}) } as Record<string, string>;
        headers['Authorization'] = `Bearer ${newAccessToken}`;
        newInit.headers = headers;
        
        console.log('[Auth Interceptor] Retrying original request with new access token...');
        res = await originalFetch(input, newInit);
      } catch (err: any) {
        refreshPromise = null;
        console.error('[Auth Interceptor] Transparent token refresh failed:', err);
        // Only log out if it is an explicit auth error (like 401/403/400 or missing refresh token)
        if (err instanceof AuthError || err?.isAuthError) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.dispatchEvent(new Event('auth-unauthorized'));
        }
      }
    }
  }

  return res;
};

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
  if (response.status === 401 || response.status === 403) {
    // Session expired or invalid
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    // We can dispatch a custom event or reload to trigger login redirect
    window.dispatchEvent(new Event('auth-unauthorized'));
    const errData = await response.json().catch(() => ({}));
    throw new AuthError(errData.message || 'Unauthorized');
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

    async refreshToken() {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new AuthError('No refresh token available');
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        
        if (res.status === 401 || res.status === 403 || res.status === 400) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.dispatchEvent(new Event('auth-unauthorized'));
          throw new AuthError(`Session expired with status: ${res.status}`);
        }
        
        const data = await handleResponse<{ accessToken: string }>(res);
        if (data.accessToken) {
          localStorage.setItem('accessToken', data.accessToken);
          return data.accessToken;
        }
        throw new Error('Access token not returned');
      } catch (err: any) {
        if (err instanceof AuthError || err?.isAuthError) throw err;
        throw err;
      }
    },

    async ensureValidToken(): Promise<string | null> {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      
      try {
        const base64Url = token.split('.')[1];
        if (base64Url) {
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(decodeURIComponent(
            atob(base64)
              .split('')
              .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          ));
          if (payload && payload.exp) {
            const expTime = payload.exp * 1000;
            // If expired or expiring in less than 30 seconds
            if (expTime - Date.now() < 30 * 1000) {
              console.log('[Auth] Token is expired or close to expiry, refreshing before action...');
              return await this.refreshToken();
            }
          }
        }
      } catch (err) {
        console.error('[Auth] Error checking token expiration:', err);
      }
      return token;
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
      return handleResponse<{ data: { _id: string; username: string; email: string; name: string; is_mfa_enabled: boolean; roles?: any[]; backup_codes?: string[] } }>(res);
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
    async list(params?: { is_active?: string; instrument_class?: string; search?: string; limit?: number }) {
      const query = new URLSearchParams();
      query.append('limit', String(params?.limit || 100));
      if (params?.is_active !== undefined) {
        query.append('is_active', params.is_active);
      }
      if (params?.instrument_class) {
        query.append('instrument_class', params.instrument_class);
      }
      if (params?.search) {
        query.append('search', params.search);
      }
      const res = await fetch(`${BASE_URL}/symbols?${query.toString()}`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[]; pagination?: any }>(res);
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

    async bulkCreate(bulkData: {
      symbol: string;
      range_count: number;
      range_option: 'ITM' | 'ATM' | 'OTM' | 'ALL';
      option_type: 'Call' | 'Put' | 'Both';
    }) {
      const res = await fetch(`${BASE_URL}/symbols/bulk`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(bulkData),
      });
      return handleResponse<{ message: string; data: any[] }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/symbols/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ data: any }>(res);
    },

    async update(id: string, updateData: { is_active?: boolean }) {
      const res = await fetch(`${BASE_URL}/symbols/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(updateData),
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
    },    // Fetch trades using any combination of account, deployment/strategy, symbol, direction, and status filters, with date ranges and sorting
    async listWithFilters(params: { 
      account_id?: string[]; 
      deployment_id?: string[]; 
      symbol?: string[]; 
      type_of_order?: string[]; 
      status?: string[]; 
      from?: string; 
      to?: string; 
      sort?: string;
      fields?: string;
      limit?: number 
    }) {
      const query = new URLSearchParams();
      
      if (params.account_id) {
        params.account_id.forEach(id => query.append('account_id', id));
      }
      if (params.deployment_id) {
        params.deployment_id.forEach(id => query.append('deployment_id', id));
      }
      if (params.symbol) {
        params.symbol.forEach(sym => query.append('symbol', sym));
      }
      if (params.type_of_order) {
        params.type_of_order.forEach(type => query.append('type_of_order', type));
      }
      if (params.status) {
        params.status.forEach(status => query.append('status', status));
      }
      if (params.from) {
        query.append('from', params.from);
      }
      if (params.to) {
        query.append('to', params.to);
      }
      if (params.sort) {
        query.append('sort', params.sort);
      }
      if (params.fields) {
        query.append('fields', params.fields);
      }
      
      query.append('limit', String(params.limit || 1000));
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
    async list(sort?: string, fields?: string) {
      const query = new URLSearchParams();
      query.append('limit', '500');
      if (sort) {
        query.append('sort', sort);
      }
      if (fields) {
        query.append('fields', fields);
      }
      const res = await fetch(`${BASE_URL}/ledger?${query.toString()}`, {
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

  brokers: {
    async list() {
      const res = await fetch(`${BASE_URL}/brokers`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(brokerData: { name: string; external_broker_id?: string; credentials?: any }) {
      const res = await fetch(`${BASE_URL}/brokers`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(brokerData),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async update(id: string, updateData: { name?: string; external_broker_id?: string; credentials?: any }) {
      const res = await fetch(`${BASE_URL}/brokers/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updateData),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/brokers/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ message: string }>(res);
    },
  },

  externalBrokers: {
    async list() {
      const res = await fetch(`${BASE_URL}/external-brokers`, {
        method: 'GET',
        headers: getHeaders(),
      });
      return handleResponse<{ items: any[] }>(res);
    },

    async create(data: { external_broker_id: string }) {
      const res = await fetch(`${BASE_URL}/external-brokers`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async update(id: string, data: { external_broker_id: string }) {
      const res = await fetch(`${BASE_URL}/external-brokers/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return handleResponse<{ data: any; message: string }>(res);
    },

    async delete(id: string) {
      const res = await fetch(`${BASE_URL}/external-brokers/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return handleResponse<{ message: string }>(res);
    },
  },
};
