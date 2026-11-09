import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Always trailing slash so relative apiPath() resolves under /backtestapp/ */
export const API_BASE = (
  process.env.API_BASE_URL ||
  (process.env.CI ? 'http://localhost/backtestapp' : 'https://algo.mrcobra.link/backtestapp')
).replace(/\/?$/, '/');
export const SERVICE_TOKEN =
  process.env.BACKTEST_SERVICE_TOKEN || 'backtest-internal-service-token';

// Prefer UI seed profiles (@cobratrades.com). moneymaker.com is a docs fallback only.
export const SEED_CREDENTIALS = {
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@cobratrades.com',
    password: process.env.ADMIN_PASSWORD || 'adminpassword123',
    fallbackEmail: 'admin@moneymaker.com',
    fallbackPassword: 'adminpassword123',
  },
  user: {
    email: process.env.USER_EMAIL || 'user@cobratrades.com',
    password: process.env.USER_PASSWORD || 'userpassword123',
    fallbackEmail: 'user@moneymaker.com',
    fallbackPassword: 'userpassword123',
  },
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId?: string;
}

/**
 * Relative API path segment (no leading slash), for use with an API-scoped baseURL.
 *
 * Prefer {@link apiUrl} for Playwright `request` calls — the UI project sets
 * baseURL to UI_BASE_URL, so relative paths would hit /backtest-ui/… (405 HTML).
 */
export function apiPath(path: string): string {
  const stripped = path.replace(/^\/+/, '');
  // Preserve intentional legacy /api/trade (and similar) paths
  if (stripped === 'api' || stripped.startsWith('api/')) return stripped;
  // Strip accidental api/ prefix from callers that still pass /api/...
  return stripped.replace(/^api\//, '');
}

/** Absolute BackTestApp URL — safe regardless of Playwright project baseURL. */
export function apiUrl(path: string): string {
  return new URL(apiPath(path), API_BASE).href;
}

function isGatewayFailure(err: unknown): boolean {
  return err instanceof Error && /: 5\d\d /.test(err.message);
}

export async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<AuthTokens> {
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await request.post(apiUrl('/auth/login'), {
      data: { email, password },
    });
    if (res.ok()) {
      const data = await res.json();
      if (data.mfaRequired) {
        throw new Error(`MFA required for ${email} — use MFA login flow in test setup`);
      }
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    }
    lastStatus = res.status();
    lastBody = await res.text();
    if (lastStatus < 500 || attempt === 8) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Login failed for ${email}: ${lastStatus} ${lastBody}`);
}

export async function loginWithFallback(
  request: APIRequestContext,
  role: 'admin' | 'user'
): Promise<AuthTokens & { email: string }> {
  const creds = SEED_CREDENTIALS[role];
  try {
    const tokens = await loginAs(request, creds.email, creds.password);
    return { ...tokens, email: creds.email };
  } catch (err) {
    if (isGatewayFailure(err)) throw err;
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
  const email = `e2e-user-b-${suffix}@e2e.test.com`;
  const username = `e2euserb${suffix}`;
  const password = 'TestPassword123!';
  const res = await apiRequest(request, adminToken).post('/admin/users', {
    data: {
      username,
      name: 'E2E User B',
      email,
      password,
    },
  });
  expectOk(res, 201);
  const body = await res.json();
  const user = body?.data ?? body;
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
  const withRetry = async (fn: () => Promise<APIResponse>) => {
    let res = await fn();
    if ([502, 503, 504].includes(res.status())) {
      await new Promise((r) => setTimeout(r, 400));
      res = await fn();
    }
    return res;
  };
  return {
    get: (path: string, opts: { params?: Record<string, string | number | boolean> } = {}) =>
      withRetry(() => request.get(apiUrl(path), { headers: headers(), params: opts.params })),
    post: (path: string, opts: { data?: unknown; headers?: Record<string, string> } = {}) =>
      withRetry(() => request.post(apiUrl(path), { headers: headers(opts.headers), data: opts.data })),
    put: (path: string, opts: { data?: unknown } = {}) =>
      withRetry(() => request.put(apiUrl(path), { headers: headers(), data: opts.data })),
    patch: (path: string, opts: { data?: unknown } = {}) =>
      withRetry(() => request.patch(apiUrl(path), { headers: headers(), data: opts.data })),
    delete: (path: string) => withRetry(() => request.delete(apiUrl(path), { headers: headers() })),
    fetch: (path: string, opts: Parameters<APIRequestContext['fetch']>[1] = {}) =>
      withRetry(() =>
        request.fetch(apiUrl(path), {
          ...opts,
          headers: { ...headers(), ...(opts.headers as Record<string, string>) },
        })
      ),
  };
}

export async function signupUser(
  request: APIRequestContext,
  suffix = Date.now()
): Promise<{ email: string; password: string; username: string; tokens: AuthTokens }> {
  const email = `e2e-signup-${suffix}@e2e.test.com`;
  const username = `e2esignup${suffix}`;
  const password = 'SignupPass123!';
  const res = await request.post(apiUrl('/auth/signup'), {
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
