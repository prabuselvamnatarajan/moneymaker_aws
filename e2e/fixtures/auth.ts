import type { APIRequestContext, APIResponse } from '@playwright/test';

export const API_BASE = process.env.API_BASE_URL || 'http://localhost/backtestapp';
export const SERVICE_TOKEN =
  process.env.BACKTEST_SERVICE_TOKEN || 'backtest-internal-service-token';

export const SEED_CREDENTIALS = {
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@moneymaker.com',
    password: process.env.ADMIN_PASSWORD || 'adminpassword123',
    fallbackEmail: 'admin@cobratrades.com',
    fallbackPassword: 'adminpassword123',
  },
  user: {
    email: process.env.USER_EMAIL || 'user@moneymaker.com',
    password: process.env.USER_PASSWORD || 'userpassword123',
    fallbackEmail: 'user@cobratrades.com',
    fallbackPassword: 'userpassword123',
  },
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId?: string;
}

export function apiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.startsWith('/api') ? normalized : `/api${normalized}`;
}

export async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<AuthTokens> {
  const res = await request.post(apiPath('/auth/login'), {
    data: { email, password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Login failed for ${email}: ${res.status()} ${body}`);
  }
  const data = await res.json();
  if (data.mfaRequired) {
    throw new Error(`MFA required for ${email} — use MFA login flow in test setup`);
  }
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

export async function loginWithFallback(
  request: APIRequestContext,
  role: 'admin' | 'user'
): Promise<AuthTokens & { email: string }> {
  const creds = SEED_CREDENTIALS[role];
  try {
    const tokens = await loginAs(request, creds.email, creds.password);
    return { ...tokens, email: creds.email };
  } catch {
    const tokens = await loginAs(request, creds.fallbackEmail, creds.fallbackPassword);
    return { ...tokens, email: creds.fallbackEmail };
  }
}

export async function loginAsAdmin(request: APIRequestContext): Promise<AuthTokens & { email: string }> {
  return loginWithFallback(request, 'admin');
}

export async function loginAsUser(request: APIRequestContext): Promise<AuthTokens & { email: string }> {
  return loginWithFallback(request, 'user');
}

export async function createUserB(
  request: APIRequestContext,
  adminToken: string,
  suffix = Date.now()
): Promise<{ userId: string; email: string; password: string; tokens: AuthTokens }> {
  const email = `e2e-user-b-${suffix}@test.local`;
  const username = `e2euserb${suffix}`;
  const password = 'TestPassword123!';
  const res = await apiRequest(request, adminToken).post(apiPath('/admin/users'), {
    data: {
      username,
      name: 'E2E User B',
      email,
      password,
    },
  });
  expectOk(res, 201);
  const user = await res.json();
  const tokens = await loginAs(request, email, password);
  return { userId: user._id || user.id, email, password, tokens };
}

export function authHeaders(token?: string, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Service-Token': SERVICE_TOKEN,
    ...extra,
  };
}

/** Wrapped request helpers with Bearer token */
export function apiRequest(request: APIRequestContext, token?: string) {
  const headers = (more: Record<string, string> = {}) => authHeaders(token, more);
  return {
    get: (path: string, opts: { params?: Record<string, string | number | boolean> } = {}) =>
      request.get(apiPath(path), { headers: headers(), params: opts.params }),
    post: (path: string, opts: { data?: unknown; headers?: Record<string, string> } = {}) =>
      request.post(apiPath(path), { headers: headers(opts.headers), data: opts.data }),
    put: (path: string, opts: { data?: unknown } = {}) =>
      request.put(apiPath(path), { headers: headers(), data: opts.data }),
    patch: (path: string, opts: { data?: unknown } = {}) =>
      request.patch(apiPath(path), { headers: headers(), data: opts.data }),
    delete: (path: string) => request.delete(apiPath(path), { headers: headers() }),
    fetch: (path: string, opts: Parameters<APIRequestContext['fetch']>[1] = {}) =>
      request.fetch(apiPath(path), {
        ...opts,
        headers: { ...headers(), ...(opts.headers as Record<string, string>) },
      }),
  };
}

export async function signupUser(
  request: APIRequestContext,
  suffix = Date.now()
): Promise<{ email: string; password: string; username: string; tokens: AuthTokens }> {
  const email = `e2e-signup-${suffix}@test.local`;
  const username = `e2esignup${suffix}`;
  const password = 'SignupPass123!';
  const res = await request.post(apiPath('/auth/signup'), {
    data: { username, name: 'Signup User', email, password },
  });
  expectOk(res, 201);
  const tokens = await loginAs(request, email, password);
  return { email, password, username, tokens };
}

export function expectOk(res: APIResponse, status = 200): void {
  if (res.status() !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status()}: ${res.statusText()}`);
  }
}

export async function getMe(request: APIRequestContext, token: string) {
  const res = await apiRequest(request, token).get('/me');
  expectOk(res);
  return res.json();
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
