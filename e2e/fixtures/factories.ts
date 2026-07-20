import type { APIRequestContext } from '@playwright/test';
import { apiRequest, loginAsUser, uniqueSuffix } from './auth';

/** Unwrap `{ message, data }` envelopes used by most BackTestApp create endpoints. */
function unwrapEntity<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body && (body as { data: unknown }).data != null) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export interface AccountRef {
  _id: string;
  account_id?: string;
  account_name: string;
  current_balance: number;
  initial_balance: number;
  broker_id?: string;
  account_type?: string;
}

export interface StrategyRef {
  _id: string;
  strategy_name: string;
  advance_trade_decision?: boolean;
  target_pts?: number;
}

export interface SymbolRef {
  _id: string;
  symbol: string;
  instrument_token: string;
  is_active?: boolean;
}

export interface DeploymentRef {
  _id: string;
  deployment_name?: string;
  current_status: string;
  strategy_mode: string;
  instrument_token?: string;
  symbol?: string;
}

export async function createAccount(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<AccountRef> {
  const suffix = uniqueSuffix();
  const payload = {
    account_name: `e2e-account-${suffix}`,
    account_type: 'PAPER',
    initial_balance: 100000,
    ...overrides,
  };
  const res = await apiRequest(request, token).post('/accounts', { data: payload });
  if (!res.ok()) {
    throw new Error(`createAccount failed: ${res.status()} ${await res.text()}`);
  }
  return unwrapEntity<AccountRef>(await res.json());
}

export async function createStrategy(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<StrategyRef> {
  const suffix = uniqueSuffix();
  const payload = {
    strategy_name: `e2e-strategy-${suffix}`,
    strategy_description: 'E2E test strategy',
    ...overrides,
  };
  const res = await apiRequest(request, token).post('/strategies', { data: payload });
  if (!res.ok()) {
    throw new Error(`createStrategy failed: ${res.status()} ${await res.text()}`);
  }
  return unwrapEntity<StrategyRef>(await res.json());
}

export async function createSymbol(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<SymbolRef> {
  const suffix = uniqueSuffix();
  const symbolName = `E2E${suffix.slice(-6)}`;
  const payload = {
    symbol_name: symbolName,
    symbol: symbolName,
    instrument_token: `E2E-TOKEN-${suffix}`,
    exchange: 'NSE',
    instrument_class: 'EQUITY',
    is_active: true,
    strike_price_diff: 50,
    ...overrides,
  };
  const res = await apiRequest(request, token).post('/symbols', { data: payload });
  if (!res.ok()) {
    throw new Error(`createSymbol failed: ${res.status()} ${await res.text()}`);
  }
  return unwrapEntity<SymbolRef>(await res.json());
}

export async function createDeployment(
  request: APIRequestContext,
  token: string,
  opts: {
    strategy_id: string;
    account_id: string;
    user_symbol_id: string;
    instrument_token: string;
    symbol: string;
    overrides?: Record<string, unknown>;
  }
): Promise<DeploymentRef> {
  const suffix = uniqueSuffix();
  const now = new Date();
  const payload = {
    deployment_name: `e2e-dep-${suffix}`,
    strategy_id: opts.strategy_id,
    account_id: opts.account_id,
    user_symbol_id: opts.user_symbol_id,
    instrument_token: opts.instrument_token,
    symbol: opts.symbol,
    start_time: now.toISOString(),
    current_status: 'SCHEDULED',
    strategy_mode: 'PAPER',
    ...opts.overrides,
  };
  const res = await apiRequest(request, token).post('/deployments', { data: payload });
  if (!res.ok()) {
    throw new Error(`createDeployment failed: ${res.status()} ${await res.text()}`);
  }
  return unwrapEntity<DeploymentRef>(await res.json());
}

export async function createTradeFixture(
  request: APIRequestContext,
  token: string,
  accountOverrides: Record<string, unknown> = {}
) {
  const account = await createAccount(request, token, {
    initial_balance: 500000,
    current_balance: 500000,
    ...accountOverrides,
  });
  const strategy = await createStrategy(request, token);
  const symbol = await createSymbol(request, token);
  const deployment = await createDeployment(request, token, {
    strategy_id: strategy._id,
    account_id: account._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
  });
  return { account, strategy, symbol, deployment };
}

export async function createTrade(
  request: APIRequestContext,
  token: string,
  payload: Record<string, unknown>
) {
  return apiRequest(request, token).post('/trades', { data: payload });
}

export async function listBrokers(request: APIRequestContext, token: string) {
  const res = await apiRequest(request, token).get('/brokers');
  if (!res.ok()) throw new Error(`listBrokers failed: ${res.status()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.items || data.brokers || [];
}

export async function getInternalBroker(request: APIRequestContext, token: string) {
  const brokers = await listBrokers(request, token);
  const internal = brokers.find((b: { is_internal?: boolean }) => b.is_internal);
  if (!internal) throw new Error('No internal broker found');
  return internal;
}

export async function getExternalBroker(request: APIRequestContext, token: string) {
  const brokers = await listBrokers(request, token);
  return brokers.find((b: { is_internal?: boolean }) => !b.is_internal);
}

export async function createExternalBrokerForUser(
  request: APIRequestContext,
  token: string,
  suffix = uniqueSuffix()
) {
  const res = await apiRequest(request, token).post('/brokers', {
    data: {
      name: `E2E External ${suffix}`,
      external_broker_id: 'upstox',
      credentials: { client_secret: 'test-secret' },
    },
  });
  if (!res.ok()) throw new Error(`createExternalBroker failed: ${res.status()}`);
  return unwrapEntity(await res.json());
}

export async function seedUserChain(request: APIRequestContext) {
  const { accessToken } = await loginAsUser(request);
  return createTradeFixture(request, accessToken);
}

export async function deposit(
  request: APIRequestContext,
  token: string,
  accountId: string,
  amount: number,
  description = 'E2E deposit'
) {
  return apiRequest(request, token).post('/ledger/deposit', {
    data: { accountId, amount, description },
  });
}

export async function getAccountBalance(
  request: APIRequestContext,
  token: string,
  accountId: string
): Promise<number> {
  const res = await apiRequest(request, token).get(`/accounts/${accountId}/balance`);
  if (!res.ok()) throw new Error(`balance fetch failed: ${res.status()}`);
  const raw = await res.json();
  const data = unwrapEntity<Record<string, number>>(raw);
  const balance = data.balance ?? data.current_balance ?? data.currentBalance;
  if (typeof balance !== 'number' || Number.isNaN(balance)) {
    throw new Error(`balance parse failed: ${JSON.stringify(raw)}`);
  }
  return balance;
}
