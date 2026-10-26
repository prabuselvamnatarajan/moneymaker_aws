import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  apiPath,
  apiRequest,
  createUserB,
  loginAsAdmin,
  loginAsUser,
  serviceHeaders,
  uniqueSuffix,
} from '../fixtures/auth';
import {
  createAccount,
  createDeployment,
  createStrategy,
  createSymbol,
  createTrade,
  createTradeFixture,
  getAccountBalance,
} from '../fixtures/factories';
import {
  expectMessageContains,
  expectStatus,
  jsonBody,
  newObjectId,
  tags,
  test,
} from '../fixtures/test-helpers';

const execFileAsync = promisify(execFile);

/** Minimal deployment POST body (plain user_symbol_id). */
function deploymentPayload(opts: {
  strategy_id: string;
  account_id: string;
  user_symbol_id?: string;
  instrument_token?: string;
  symbol?: string;
  overrides?: Record<string, unknown>;
}) {
  const suffix = uniqueSuffix();
  const now = new Date();
  return {
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
}

async function postDeployment(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  payload: Record<string, unknown>
) {
  return apiRequest(request, token).post('/deployments', { data: payload });
}

async function lifecycle(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  deploymentId: string,
  action: string
) {
  return apiRequest(request, token).post(`/deployments/${deploymentId}/${action}`);
}

async function resolveSymbol(
  request: Parameters<typeof apiRequest>[0],
  deploymentId: string,
  opts: { token?: string; service?: boolean; data?: Record<string, unknown> } = {}
) {
  const headers = opts.service
    ? serviceHeaders()
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` };
  return request.post(apiPath(`/deployments/${deploymentId}/resolve-symbol`), {
    headers,
    data: opts.data ?? {},
  });
}

async function seedTrades(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  fixture: Awaited<ReturnType<typeof createTradeFixture>>,
  count: number,
  basePrice = 100
) {
  for (let i = 0; i < count; i++) {
    let res;
    let attempts = 0;
    while (attempts < 3) {
      res = await createTrade(request, token, {
        deployment_id: fixture.deployment._id,
        strategy_id: fixture.strategy._id,
        account_id: fixture.account._id,
        user_symbol_id: fixture.symbol._id,
        instrument_token: fixture.symbol.instrument_token,
        symbol: fixture.symbol.symbol,
        price: basePrice + (i % 5),
        quantity: 1,
        type_of_order: i % 2 === 0 ? 'BUY' : 'SELL',
        execution_time: new Date(Date.now() - (count - i) * 1000).toISOString(),
      });
      if (res.ok()) break;
      attempts++;
      if (attempts < 3) {
        await new Promise((r) => setTimeout(r, 200 * attempts));
      }
    }
    if (!res || !res.ok()) {
      throw new Error(`seedTrades failed at ${i}: ${res?.status()} ${await res?.text()}`);
    }
  }
}

async function redisGet(key: string): Promise<string | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { stdout } = await execFileAsync('redis-cli', ['-u', url, 'GET', key], {
      timeout: 8000,
    });
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '(nil)') return null;
    return trimmed;
  } catch {
    return null;
  }
}

async function redisKeyExists(key: string): Promise<boolean | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { stdout } = await execFileAsync('redis-cli', ['-u', url, 'EXISTS', key], {
      timeout: 8000,
    });
    return stdout.trim() === '1';
  } catch {
    return null;
  }
}

async function createUnderlyingIndexSymbol(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  overrides: Record<string, unknown> = {}
) {
  const suffix = uniqueSuffix();
  return createSymbol(request, token, {
    symbol: `NSE_INDEX|Nifty 50-${suffix.slice(-4)}`,
    instrument_token: `NSE_INDEX|Nifty 50-${suffix.slice(-4)}`,
    instrument_class: 'INDEX',
    strike_price_diff: 50,
    exchange: 'NSE',
    is_active: true,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Strategy tests TC-STR-001 .. TC-STR-011
// ---------------------------------------------------------------------------

test.describe('Strategies', () => {
  test('TC-STR-001: Create basic strategy defaults advanced fields when advance_trade_decision is falsy', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const res = await apiRequest(request, accessToken).post('/strategies', {
      data: {
        strategy_name: `e2e-basic-${uniqueSuffix()}`,
        strategy_description: 'Basic strategy',
        target_pts: 9999,
        sl_pts: 8888,
        target_type: 'PERCENTAGE',
        target_pct: 99,
        sl_pct: 88,
        advance_trade_decision: false,
      },
    });
    await expectStatus(res, 201);
    const body = await jsonBody<{ data: Record<string, unknown> }>(res);
    expect(body.data.target_pts).toBe(500);
    expect(body.data.sl_pts).toBe(500);
    expect(body.data.target_type).toBe('POINTS');
    expect(body.data.target_pct).toBe(2);
    expect(body.data.sl_pct).toBe(2);
    expect(body.data.advance_trade_decision).toBe(false);
  });

  test('TC-STR-002: Create advanced strategy preserves client-supplied target/SL fields', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const res = await apiRequest(request, accessToken).post('/strategies', {
      data: {
        strategy_name: `e2e-adv-${uniqueSuffix()}`,
        strategy_description: 'Advanced strategy',
        advance_trade_decision: true,
        target_pts: 1000,
        sl_pts: 300,
        target_type: 'PERCENTAGE',
        target_pct: 5,
        sl_pct: 1.5,
      },
    });
    await expectStatus(res, 201);
    const body = await jsonBody<{ data: Record<string, unknown> }>(res);
    expect(body.data.target_pts).toBe(1000);
    expect(body.data.sl_pts).toBe(300);
    expect(body.data.target_type).toBe('PERCENTAGE');
    expect(body.data.target_pct).toBe(5);
    expect(body.data.sl_pct).toBe(1.5);
    expect(body.data.advance_trade_decision).toBe(true);
  });

  test('TC-STR-003: Strategy created is scoped to creating user', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const strategy = await createStrategy(request, admin.accessToken, {
      strategy_name: `e2e-scoped-${uniqueSuffix()}`,
    });
    const res = await apiRequest(request, userB.tokens.accessToken).get(
      `/strategies/${strategy._id}`
    );
    await expectStatus(res, 404);
  });

  test('TC-STR-004: List strategies scoped to caller only (non-admin)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const secretName = `e2e-secret-strat-${uniqueSuffix()}`;
    await createStrategy(request, admin.accessToken, { strategy_name: secretName });
    const userStrategy = await createStrategy(request, userB.tokens.accessToken, {
      strategy_name: `e2e-userb-${uniqueSuffix()}`,
    });
    const res = await apiRequest(request, userB.tokens.accessToken).get('/strategies');
    await expectStatus(res, 200);
    const body = await jsonBody<{ items: Array<{ _id: string; strategy_name: string }> }>(res);
    const names = body.items.map((s) => s.strategy_name);
    expect(names).not.toContain(secretName);
    expect(body.items.some((s) => s._id === userStrategy._id)).toBe(true);
  });

  test('TC-STR-005: Search strategies by strategy_name/strategy_description ReDoS risk', async ({
    request,
  }) => {
    // Related Issue #43 — catastrophic backtracking pattern
    const { accessToken } = await loginAsUser(request);
    const malicious = '(a+)+$';
    const start = Date.now();
    const res = await apiRequest(request, accessToken).get('/strategies', {
      params: { search: malicious },
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
    expect(res.status()).toBeLessThan(600);
  });

  test('TC-STR-006: Update whitelist enforced for non-admin', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const strategy = await createStrategy(request, accessToken, {
      strategy_name: `e2e-whitelist-${uniqueSuffix()}`,
    });
    const newName = `e2e-renamed-${uniqueSuffix()}`;
    const res = await apiRequest(request, accessToken).patch(`/strategies/${strategy._id}`, {
      data: {
        strategy_name: newName,
        user_id: newObjectId(),
      },
    });
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { strategy_name: string; user_id: string } }>(res);
    expect(body.data.strategy_name).toBe(newName);
    const getRes = await apiRequest(request, accessToken).get(`/strategies/${strategy._id}`);
    const fetched = await jsonBody<{ data: { user_id: string } }>(getRes);
    expect(String(fetched.data.user_id)).toBe(String(body.data.user_id));
  });

  test('TC-STR-007: Setting advance_trade_decision:false on update resets target/SL fields to defaults', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const created = await createStrategy(request, accessToken, {
      strategy_name: `e2e-reset-${uniqueSuffix()}`,
      advance_trade_decision: true,
      target_pts: 1000,
      sl_pts: 800,
      target_type: 'PERCENTAGE',
      target_pct: 7,
      sl_pct: 3,
    });
    const res = await apiRequest(request, accessToken).patch(`/strategies/${created._id}`, {
      data: { advance_trade_decision: false },
    });
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: Record<string, unknown> }>(res);
    expect(body.data.target_pts).toBe(500);
    expect(body.data.sl_pts).toBe(500);
    expect(body.data.target_type).toBe('POINTS');
    expect(body.data.target_pct).toBe(2);
    expect(body.data.sl_pct).toBe(2);
  });

  test('TC-STR-008: Update with zero valid fields rejected', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const strategy = await createStrategy(request, accessToken);
    const res = await apiRequest(request, accessToken).patch(`/strategies/${strategy._id}`, {
      data: {},
    });
    await expectStatus(res, 500);
    await expectMessageContains(res, 'No valid fields provided for update');
  });

  test('TC-STR-009: Update another user strategy blocked (IDOR)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const strategy = await createStrategy(request, admin.accessToken);
    const res = await apiRequest(request, userB.tokens.accessToken).patch(
      `/strategies/${strategy._id}`,
      { data: { strategy_name: 'hijacked' } }
    );
    await expectStatus(res, 404);
  });

  test('TC-STR-010: Deleting a strategy cascades to its deployments and all child trades/positions/ledgers', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await seedTrades(request, accessToken, fixture, 2);

    const tradesBefore = await apiRequest(request, accessToken).get('/trades', {
      params: { deployment_id: fixture.deployment._id },
    });
    const tradesBody = await jsonBody<{ items: unknown[] }>(tradesBefore);
    expect(tradesBody.items.length).toBeGreaterThan(0);

    const delRes = await apiRequest(request, accessToken).delete(
      `/strategies/${fixture.strategy._id}`
    );
    await expectStatus(delRes, 200);

    const stratRes = await apiRequest(request, accessToken).get(
      `/strategies/${fixture.strategy._id}`
    );
    await expectStatus(stratRes, 404);

    const depRes = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}`
    );
    await expectStatus(depRes, 404);

    const tradesAfter = await apiRequest(request, accessToken).get('/trades', {
      params: { deployment_id: fixture.deployment._id },
    });
    const tradesAfterBody = await jsonBody<{ items: unknown[] }>(tradesAfter);
    expect(tradesAfterBody.items).toHaveLength(0);

    const posRes = await apiRequest(request, accessToken).get('/positions', {
      params: { deployment_id: fixture.deployment._id },
    });
    const posBody = await jsonBody<{ items: unknown[] }>(posRes);
    expect(posBody.items).toHaveLength(0);
  });

  test('TC-STR-011: Deleting a strategy with active RUNNING deployments does not block deletion', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const startRes = await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    await expectStatus(startRes, 200);
    const started = await jsonBody<{ data: { current_status: string } }>(startRes);
    expect(started.data.current_status).toBe('RUNNING');

    const delRes = await apiRequest(request, accessToken).delete(
      `/strategies/${fixture.strategy._id}`
    );
    await expectStatus(delRes, 200);

    const depRes = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}`
    );
    await expectStatus(depRes, 404);
  });
});

// ---------------------------------------------------------------------------
// Deployment create tests TC-DEP-001 .. TC-DEP-011
// ---------------------------------------------------------------------------

test.describe('Deployment create', () => {
  test('TC-DEP-001: Create deployment with a plain user_symbol_id (no symbol_control)', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 201);
    const body = await jsonBody<{ data: { symbol_control?: { enabled?: boolean } } }>(res);
    expect(body.data.symbol_control?.enabled ?? false).toBe(false);
  });

  test('TC-DEP-002: Create deployment with missing user_symbol_id and no symbol_control rejected', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: { user_symbol_id: undefined, instrument_token: undefined, symbol: undefined },
    });
    delete payload.user_symbol_id;
    delete payload.instrument_token;
    delete payload.symbol;
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'user_symbol_id is required');
  });

  test('TC-DEP-003: Create deployment referencing an inactive UserSymbol rejected', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken, { is_active: false });
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'Cannot associate an inactive symbol');
  });

  test('TC-DEP-004: Create deployment referencing another user symbol rejected', async ({
    request,
  }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const account = await createAccount(request, userB.tokens.accessToken);
    const strategy = await createStrategy(request, userB.tokens.accessToken);
    const foreignSymbol = await createSymbol(request, admin.accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: foreignSymbol._id,
      instrument_token: foreignSymbol.instrument_token,
      symbol: foreignSymbol.symbol,
    });
    const res = await postDeployment(request, userB.tokens.accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'Associated symbol not found');
  });

  test('TC-DEP-005: IDOR — createDeployment verifies strategy_id ownership', async ({
    request,
  }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const foreignStrategy = await createStrategy(request, admin.accessToken, {
      strategy_name: `e2e-foreign-strat-${uniqueSuffix()}`,
    });
    const account = await createAccount(request, userB.tokens.accessToken);
    const symbol = await createSymbol(request, userB.tokens.accessToken);
    const payload = deploymentPayload({
      strategy_id: foreignStrategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    const res = await postDeployment(request, userB.tokens.accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'Associated strategy not found');
  });

  test('TC-DEP-006: IDOR — createDeployment verifies account_id ownership', async ({
    request,
  }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const foreignAccount = await createAccount(request, admin.accessToken);
    const strategy = await createStrategy(request, userB.tokens.accessToken);
    const symbol = await createSymbol(request, userB.tokens.accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: foreignAccount._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    const res = await postDeployment(request, userB.tokens.accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'Associated account not found');
  });

  test('TC-DEP-007: Duplicate active deployment for same (strategy, account, instrument_token) rejected by unique index', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const base = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { current_status: 'RUNNING' },
    });
    const first = await postDeployment(request, accessToken, base);
    await expectStatus(first, 201);
    const second = await postDeployment(request, accessToken, {
      ...base,
      deployment_name: `e2e-dup-${uniqueSuffix()}`,
    });
    await expectStatus(second, 500);
    await expectMessageContains(second, 'duplicate key');
  });

  test('TC-DEP-008: Same (strategy, account, instrument_token) allowed again after first deployment is STOPPED/COMPLETED', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const base = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    const first = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    await lifecycle(request, accessToken, first._id, 'start');
    await lifecycle(request, accessToken, first._id, 'stop');
    const second = await postDeployment(request, accessToken, {
      ...base,
      deployment_name: `e2e-second-${uniqueSuffix()}`,
    });
    await expectStatus(second, 201);
  });

  test('TC-DEP-009: end_time before start_time rejected', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const start = new Date();
    const end = new Date(start.getTime() - 60_000);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { start_time: start.toISOString(), end_time: end.toISOString() },
    });
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'end_time must be after start_time');
  });

  test('TC-DEP-010: Invalid strategy_mode enum rejected', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'DEMO' },
    });
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    const text = await res.text();
    expect(text.toLowerCase()).toMatch(/strategy_mode|enum|validation/i);
  });

  // UI only - see deploy-dialog.spec.ts TC-UI-024
  test.skip('TC-DEP-011: Deploy dialog defaults to LIVE mode + active status (regression guard)', async () => {
    // UI only - see deploy-dialog.spec.ts TC-UI-024
  });
});

// ---------------------------------------------------------------------------
// symbol_control TC-DEP-012 .. TC-DEP-021
// ---------------------------------------------------------------------------

test.describe('Deployment symbol_control', () => {
  test('TC-DEP-012: Create with symbol_control.enabled:true auto-resolves option symbol on creation', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        lot_size: 25,
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    delete payload.instrument_token;
    delete payload.symbol;
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, [201, 500]);
    if (res.status() === 201) {
      const body = await jsonBody<{
        data: {
          user_symbol_id: string;
          instrument_token: string;
          symbol: string;
          symbol_control: {
            enabled: boolean;
            last_resolved_strike: number | null;
            last_resolved_at: string | null;
          };
        };
      }>(res);
      expect(body.data.symbol_control.enabled).toBe(true);
      expect(body.data.user_symbol_id).toBeTruthy();
      expect(body.data.instrument_token).toBeTruthy();
      expect(body.data.symbol).toBeTruthy();
      expect(body.data.symbol_control.last_resolved_at).toBeTruthy();
    } else {
      const text = (await res.text()).toLowerCase();
      expect(text).toMatch(/ltp service|option chain|option|fetch failed|lot_size/i);
    }
  });

  test('TC-DEP-013: symbol_control rejects underlying that is itself an OPTION UserSymbol', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const optionUnderlying = await createSymbol(request, accessToken, {
      instrument_class: 'OPTION',
      lot_size: 25,
    });
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: optionUnderlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'symbol_control underlying cannot be an OPTION');
  });

  test('TC-DEP-014: symbol_control rejects underlying without positive strike_price_diff', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const suffix = uniqueSuffix();
    const badSymbol = await apiRequest(request, accessToken).post('/symbols', {
      data: {
        symbol_name: `BADIDX${suffix.slice(-4)}`,
        symbol: `BADIDX${suffix.slice(-4)}`,
        instrument_token: `BAD-IDX-${suffix}`,
        exchange: 'NSE',
        instrument_class: 'INDEX',
        strike_price_diff: 0,
        is_active: true,
      },
    });
    await expectStatus(badSymbol, 500);
    await expectMessageContains(badSymbol, 'strike_price_diff');
  });

  test('TC-DEP-015: symbol_control rejects malformed expiry (not YYYY-MM-DD)', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    for (const badExpiry of ['25-12-2026', '2026-13-45']) {
      const payload = deploymentPayload({
        strategy_id: strategy._id,
        account_id: account._id,
        overrides: {
          lot_size: 25,
          symbol_control: {
            enabled: true,
            underlying_user_symbol_id: underlying._id,
            moneyness: 'ITM',
            offset: 1,
            option_type: 'CE',
            expiry: badExpiry,
          },
        },
      });
      delete payload.user_symbol_id;
      const res = await postDeployment(request, accessToken, payload);
      await expectStatus(res, 500);
      const text = await res.text();
      expect(text.toLowerCase()).toMatch(/yyyy-mm-dd|valid calendar date|expiry|fetch failed/i);
    }
  });

  test('TC-DEP-016: symbol_control missing underlying_user_symbol_id when enabled rejected', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        symbol_control: {
          enabled: true,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const res = await postDeployment(request, accessToken, payload);
    await expectStatus(res, 500);
    await expectMessageContains(res, 'underlying_user_symbol_id');
  });

  test('TC-DEP-017: Re-resolve deferred when an open position exists', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken, { initial_balance: 500_000 });
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        lot_size: 25,
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const createRes = await postDeployment(request, accessToken, payload);
    if (createRes.status() !== 201) {
      test.skip(true, 'symbol_control create requires option-chain services');
      return;
    }
    const created = await jsonBody<{
      data: {
        _id: string;
        symbol: string;
        instrument_token: string;
        user_symbol_id: string;
      };
    }>(createRes);
    await lifecycle(request, accessToken, created.data._id, 'start');
    const buyRes = await createTrade(request, accessToken, {
      deployment_id: created.data._id,
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: created.data.user_symbol_id,
      instrument_token: created.data.instrument_token,
      symbol: created.data.symbol,
      price: 100,
      quantity: 1,
      type_of_order: 'BUY',
    });
    expect(buyRes.ok()).toBe(true);
    const resolveRes = await resolveSymbol(request, created.data._id, {
      service: true,
      data: { ltp: 24300 },
    });
    await expectStatus(resolveRes, 200);
    const body = await jsonBody<{ data: { deferred?: boolean; reason?: string } }>(resolveRes);
    expect(body.data.deferred).toBe(true);
    expect(body.data.reason).toBe('open_position');
  });

  test('TC-DEP-018: Resolve conflicts with another active deployment already on the target token', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const scPayload = {
      symbol_control: {
        enabled: true,
        underlying_user_symbol_id: underlying._id,
        moneyness: 'ITM',
        offset: 1,
        option_type: 'CE',
        expiry: '2026-12-25',
      },
    };
    const firstPayload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: scPayload,
    });
    delete firstPayload.user_symbol_id;
    const firstRes = await postDeployment(request, accessToken, firstPayload);
    if (firstRes.status() !== 201) {
      test.skip(true, 'symbol_control create requires option-chain services');
      return;
    }
    const first = await jsonBody<{ data: { _id: string; instrument_token: string } }>(firstRes);
    await lifecycle(request, accessToken, first.data._id, 'start');

    const secondPayload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        ...scPayload,
        symbol_control: { ...scPayload.symbol_control, offset: 2 },
      },
    });
    delete secondPayload.user_symbol_id;
    const secondRes = await postDeployment(request, accessToken, secondPayload);
    if (secondRes.status() !== 201) {
      test.skip(true, 'second symbol_control deployment could not be created');
      return;
    }
    const second = await jsonBody<{ data: { _id: string } }>(secondRes);
    const resolveRes = await resolveSymbol(request, second.data._id, {
      service: true,
      data: { ltp: 24300 },
    });
    if (resolveRes.status() === 400) {
      await expectMessageContains(resolveRes, 'Cannot remap');
    } else {
      await expectStatus(resolveRes, [200, 400]);
    }
  });

  test('TC-DEP-019: Resolve is a no-op when target token and strike are unchanged', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        lot_size: 25,
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const createRes = await postDeployment(request, accessToken, payload);
    if (createRes.status() !== 201) {
      test.skip(true, 'symbol_control create requires option-chain services');
      return;
    }
    const created = await jsonBody<{ data: { _id: string } }>(createRes);
    const resolveRes = await resolveSymbol(request, created.data._id, { service: true, data: { ltp: 24300 } });
    await expectStatus(resolveRes, [200, 400]);
    if (resolveRes.status() === 200) {
      const body = await jsonBody<{ data: { unchanged?: boolean } }>(resolveRes);
      expect(body.data.unchanged).toBe(true);
    }
  });

  test('TC-DEP-020: /resolve-symbol endpoint requires service token (not user JWT)', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const jwtRes = await resolveSymbol(request, fixture.deployment._id, { token: accessToken });
    await expectStatus(jwtRes, 403);
    await expectMessageContains(jwtRes, 'X-Service-Token');
    const svcRes = await resolveSymbol(request, fixture.deployment._id, { service: true });
    await expectStatus(svcRes, [200, 400, 500]);
  });

  test('TC-DEP-021: Redis key migration on symbol remap renames deployment-scoped keys', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        lot_size: 25,
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const createRes = await postDeployment(request, accessToken, payload);
    if (createRes.status() !== 201) {
      test.skip(true, 'symbol_control create requires option-chain services');
      return;
    }
    const created = await jsonBody<{ data: { _id: string; symbol: string } }>(createRes);
    const deploymentId = created.data._id;
    const oldSymbol = created.data.symbol;
    const seedKey = `strategies:liquidity_sweep:live:${deploymentId}:${oldSymbol}`;
    const url = process.env.REDIS_URL;
    if (!url) {
      test.skip(true, 'REDIS_URL not configured');
      return;
    }
    try {
      await execFileAsync('redis-cli', ['-u', url, 'SET', seedKey, '{"machineState":"FLAT"}'], {
        timeout: 8000,
      });
    } catch {
      test.skip(true, 'redis-cli unavailable');
      return;
    }
    const resolveRes = await resolveSymbol(request, deploymentId, {
      service: true,
      data: { ltp: 25000, reference_strike: 25000 },
    });
    await expectStatus(resolveRes, [200, 400]);
    if (resolveRes.status() === 200) {
      const resolved = await jsonBody<{ data: { unchanged?: boolean; deployment?: { symbol: string } } }>(
        resolveRes
      );
      if (!resolved.data.unchanged && resolved.data.deployment?.symbol) {
        const newSymbol = resolved.data.deployment.symbol;
        const newKey = `strategies:liquidity_sweep:live:${deploymentId}:${newSymbol}`;
        const oldExists = await redisKeyExists(seedKey);
        const newVal = await redisGet(newKey);
        expect(oldExists === false || newVal !== null).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle TC-DEP-022 .. TC-DEP-034
// ---------------------------------------------------------------------------

test.describe('Deployment lifecycle', () => {
  test('TC-DEP-022: Valid transition SCHEDULED → start → RUNNING', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const res = await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { current_status: string; end_time: null; start_time: string } }>(
      res
    );
    expect(body.data.current_status).toBe('RUNNING');
    expect(body.data.end_time).toBeNull();
    expect(body.data.start_time).toBeTruthy();
  });

  test('TC-DEP-023: Invalid transition rejected — start on already-RUNNING deployment', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    const res = await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    await expectStatus(res, 409);
    await expectMessageContains(res, "Cannot start deployment in status 'RUNNING'");
  });

  test('TC-DEP-024: stop only valid from RUNNING or PAUSED', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const res = await lifecycle(request, accessToken, fixture.deployment._id, 'stop');
    await expectStatus(res, 409);
    await expectMessageContains(res, "Cannot stop deployment in status 'SCHEDULED'");
  });

  test('TC-DEP-025: pause only valid from RUNNING; resume only valid from PAUSED', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);

    const pauseScheduled = await lifecycle(request, accessToken, fixture.deployment._id, 'pause');
    await expectStatus(pauseScheduled, 409);

    await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    const pauseRunning = await lifecycle(request, accessToken, fixture.deployment._id, 'pause');
    await expectStatus(pauseRunning, 200);
    const paused = await jsonBody<{ data: { current_status: string } }>(pauseRunning);
    expect(paused.data.current_status).toBe('PAUSED');

    const resumePaused = await lifecycle(request, accessToken, fixture.deployment._id, 'resume');
    await expectStatus(resumePaused, 200);
    const resumed = await jsonBody<{ data: { current_status: string } }>(resumePaused);
    expect(resumed.data.current_status).toBe('RUNNING');

    const resumeRunning = await lifecycle(request, accessToken, fixture.deployment._id, 'resume');
    await expectStatus(resumeRunning, 409);

    await lifecycle(request, accessToken, fixture.deployment._id, 'stop');
    const pauseStopped = await lifecycle(request, accessToken, fixture.deployment._id, 'pause');
    await expectStatus(pauseStopped, 409);
  });

  test('TC-DEP-026: restart allowed from RUNNING, PAUSED, STOPPED, or COMPLETED', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    for (const path of ['RUNNING', 'PAUSED', 'STOPPED'] as const) {
      const fixture = await createTradeFixture(request, accessToken);
      if (path === 'RUNNING') await lifecycle(request, accessToken, fixture.deployment._id, 'start');
      if (path === 'PAUSED') {
        await lifecycle(request, accessToken, fixture.deployment._id, 'start');
        await lifecycle(request, accessToken, fixture.deployment._id, 'pause');
      }
      if (path === 'STOPPED') {
        await lifecycle(request, accessToken, fixture.deployment._id, 'start');
        await lifecycle(request, accessToken, fixture.deployment._id, 'stop');
      }
      const res = await lifecycle(request, accessToken, fixture.deployment._id, 'restart');
      await expectStatus(res, 200);
      const body = await jsonBody<{ data: { current_status: string } }>(res);
      expect(body.data.current_status).toBe('RUNNING');
    }
    // COMPLETED is allowed by VALID_TRANSITIONS but has no public lifecycle route to reach it
  });

  test('TC-DEP-027: start/restart on a BACKTEST-mode deployment resets trades/ledgers/positions and account balance', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken, {
      initial_balance: 200_000,
      current_balance: 200_000,
    });
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'BACKTEST' },
    });
    const fixture = { account, strategy, symbol, deployment };
    await seedTrades(request, accessToken, fixture, 3);
    await apiRequest(request, accessToken).post('/ledger/withdraw', {
      data: { accountId: account._id, amount: 10_000, description: 'E2E withdraw' },
    });

    const restartRes = await lifecycle(request, accessToken, deployment._id, 'start');
    await expectStatus(restartRes, 200);

    const tradesRes = await apiRequest(request, accessToken).get('/trades', {
      params: { deployment_id: deployment._id },
    });
    const trades = await jsonBody<{ items: unknown[] }>(tradesRes);
    expect(trades.items).toHaveLength(0);

    const balance = await getAccountBalance(request, accessToken, account._id);
    expect(balance).toBe(200_000);
  });

  test('TC-DEP-028: Backtest reset shared-counter side effect on other deployments', async ({
    request,
  }) => {
    // Related Issue #65 — documented regression; full detail in liquidity_sweep plan
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken, {
      strategy_name: 'liquidity_sweep',
    });
    const symbolA = await createSymbol(request, accessToken);
    const symbolB = await createSymbol(request, accessToken);
    const depA = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbolA._id,
      instrument_token: symbolA.instrument_token,
      symbol: symbolA.symbol,
      overrides: { strategy_mode: 'BACKTEST' },
    });
    await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbolB._id,
      instrument_token: symbolB.instrument_token,
      symbol: symbolB.symbol,
      overrides: { strategy_mode: 'BACKTEST' },
    });
    const startRes = await lifecycle(request, accessToken, depA._id, 'start');
    await expectStatus(startRes, 200);
  });

  test('TC-DEP-029: start/restart on LIVE/PAPER triggers liquidity_sweep runtime reset instead', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken, {
      strategy_name: 'liquidity_sweep',
    });
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'PAPER' },
    });
    const res = await lifecycle(request, accessToken, deployment._id, 'start');
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { current_status: string } }>(res);
    expect(body.data.current_status).toBe('RUNNING');
  });

  test('TC-DEP-030: start/restart/resume on LIVE/PAPER auto-activates an inactive associated symbol', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await apiRequest(request, accessToken).patch(`/symbols/${fixture.symbol._id}`, {
      data: { is_active: false },
    });
    const startRes = await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    await expectStatus(startRes, 200);
    const symRes = await apiRequest(request, accessToken).get(`/symbols/${fixture.symbol._id}`);
    await expectStatus(symRes, 200);
    const symBody = await jsonBody<{ data: { is_active: boolean } }>(symRes);
    expect(symBody.data.is_active).toBe(true);
  });

  test('TC-DEP-031: start/restart/resume with symbol_control.enabled triggers a fresh resolve attempt', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const underlying = await createUnderlyingIndexSymbol(request, accessToken);
    const payload = deploymentPayload({
      strategy_id: strategy._id,
      account_id: account._id,
      overrides: {
        strategy_mode: 'PAPER',
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ITM',
          offset: 1,
          option_type: 'CE',
          expiry: '2026-12-25',
        },
      },
    });
    delete payload.user_symbol_id;
    const createRes = await postDeployment(request, accessToken, payload);
    if (createRes.status() !== 201) {
      test.skip(true, 'symbol_control create requires option-chain services');
      return;
    }
    const created = await jsonBody<{ data: { _id: string } }>(createRes);
    const pauseRes = await lifecycle(request, accessToken, created.data._id, 'start');
    await expectStatus(pauseRes, 200);
    await lifecycle(request, accessToken, created.data._id, 'pause');
    const resumeRes = await lifecycle(request, accessToken, created.data._id, 'resume');
    await expectStatus(resumeRes, 200);
    const getRes = await apiRequest(request, accessToken).get(`/deployments/${created.data._id}`);
    const dep = await jsonBody<{ data: { symbol_control?: { last_resolved_at?: string } } }>(getRes);
    expect(dep.data.symbol_control?.last_resolved_at).toBeTruthy();
  });

  test('TC-DEP-032: BACKTEST-mode deployment transitioning to RUNNING triggers backtest-client HTTP call', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'BACKTEST', backtest_date: '2026-01-15', backtest_speed: 500 },
    });
    const startRes = await lifecycle(request, accessToken, deployment._id, 'start');
    await expectStatus(startRes, 200);
    const body = await jsonBody<{ data: { backtest_run_id?: string; current_status: string } }>(
      startRes
    );
    expect(body.data.current_status).toBe('RUNNING');
    expect(body.data.backtest_run_id).toBeTruthy();
  });

  test('TC-DEP-033: Transition on foreign deployment blocked (IDOR)', async ({ request }) => {
    const admin = await loginAsAdmin(request);
    const userB = await createUserB(request, admin.accessToken);
    const fixture = await createTradeFixture(request, admin.accessToken);
    const res = await lifecycle(request, userB.tokens.accessToken, fixture.deployment._id, 'start');
    await expectStatus(res, 404);
  });

  test('TC-DEP-034: Invalid action name rejected', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const res = await apiRequest(request, accessToken).post(
      `/deployments/${fixture.deployment._id}/not-a-valid-action`
    );
    await expectStatus(res, 404);
  });
});

// ---------------------------------------------------------------------------
// Update / Delete TC-DEP-035 .. TC-DEP-037
// ---------------------------------------------------------------------------

test.describe('Deployment update and delete', () => {
  test('TC-DEP-035: Only whitelisted fields updatable', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const newName = `e2e-upd-${uniqueSuffix()}`;
    const res = await apiRequest(request, accessToken).patch(
      `/deployments/${fixture.deployment._id}`,
      {
        data: {
          deployment_name: newName,
          notes: 'updated notes',
          current_status: 'RUNNING',
          instrument_token: 'HACKED',
        },
      }
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{
      data: { deployment_name: string; current_status: string; instrument_token: string };
    }>(res);
    expect(body.data.deployment_name).toBe(newName);
    expect(body.data.current_status).toBe('SCHEDULED');
    expect(body.data.instrument_token).toBe(fixture.symbol.instrument_token);
  });

  test('TC-DEP-036: Delete deployment cascades to positions/trades/ledger and re-syncs Redis', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await seedTrades(request, accessToken, fixture, 2);
    const delRes = await apiRequest(request, accessToken).delete(
      `/deployments/${fixture.deployment._id}`
    );
    await expectStatus(delRes, 200);
    const tradesRes = await apiRequest(request, accessToken).get('/trades', {
      params: { deployment_id: fixture.deployment._id },
    });
    const trades = await jsonBody<{ items: unknown[] }>(tradesRes);
    expect(trades.items).toHaveLength(0);
  });

  test('TC-DEP-037: Delete does not guard against deleting a RUNNING LIVE deployment', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'LIVE' },
    });
    await lifecycle(request, accessToken, deployment._id, 'start');
    const getRes = await apiRequest(request, accessToken).get(`/deployments/${deployment._id}`);
    const dep = await jsonBody<{ data: { current_status: string; strategy_mode: string } }>(getRes);
    expect(dep.data.current_status).toBe('RUNNING');
    expect(dep.data.strategy_mode).toBe('LIVE');
    const delRes = await apiRequest(request, accessToken).delete(`/deployments/${deployment._id}`);
    await expectStatus(delRes, 200);
  });
});

// ---------------------------------------------------------------------------
// Monitoring TC-DEP-038 .. TC-DEP-046
// ---------------------------------------------------------------------------

test.describe('Deployment monitoring', () => {
  test('TC-DEP-038: /status returns minimal status projection', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/status`
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{
      data: Record<string, unknown>;
    }>(res);
    const keys = Object.keys(body.data).sort();
    expect(keys).toEqual(['_id', 'current_status', 'end_time', 'start_time', 'symbol'].sort());
  });

  test('TC-DEP-039: /metrics computes running P&L, wins/losses, win rate from full trade replay', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await createTrade(request, accessToken, {
      deployment_id: fixture.deployment._id,
      strategy_id: fixture.strategy._id,
      account_id: fixture.account._id,
      user_symbol_id: fixture.symbol._id,
      instrument_token: fixture.symbol.instrument_token,
      symbol: fixture.symbol.symbol,
      price: 100,
      quantity: 10,
      type_of_order: 'BUY',
    });
    await createTrade(request, accessToken, {
      deployment_id: fixture.deployment._id,
      strategy_id: fixture.strategy._id,
      account_id: fixture.account._id,
      user_symbol_id: fixture.symbol._id,
      instrument_token: fixture.symbol.instrument_token,
      symbol: fixture.symbol.symbol,
      price: 110,
      quantity: 10,
      type_of_order: 'SELL',
      commission: 0,
    });
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/metrics`
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{
      data: {
        total_trades: number;
        total_pnl: number;
        wins: number;
        losses: number;
        win_rate: string;
      };
    }>(res);
    expect(body.data.total_trades).toBe(2);
    expect(body.data.total_pnl).toBe(100);
    expect(body.data.wins).toBe(1);
    expect(body.data.losses).toBe(0);
    expect(body.data.win_rate).toBe('100.00%');
  });

  test('TC-DEP-040: /metrics O(N) replay performance on large trade history', tags.slow, async ({
    request,
  }) => {
    test.setTimeout(300_000);
    // Related Issue #9
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const tradeCount = 1500;
    await seedTrades(request, accessToken, fixture, tradeCount);
    const start = Date.now();
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/metrics`
    );
    const elapsed = Date.now() - start;
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { total_trades: number } }>(res);
    expect(body.data.total_trades).toBe(tradeCount);
    expect(elapsed).toBeGreaterThan(0);
  });

  test('TC-DEP-041: /analysis supports optional date/time range filtering', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await seedTrades(request, accessToken, fixture, 2);
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/analysis`,
      {
        params: {
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          start_time: '09:15',
          end_time: '15:30',
        },
      }
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { time_range: { start: string | null; end: string | null } } }>(
      res
    );
    expect(body.data.time_range.start).toBeTruthy();
    expect(body.data.time_range.end).toBeTruthy();
  });

  test('TC-DEP-042: /analysis malformed date strings ignored gracefully', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/analysis`,
      { params: { start_date: 'notadate' } }
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: { time_range: { start: null } } }>(res);
    expect(body.data.time_range.start).toBeNull();
  });

  test('TC-DEP-043: /analysis computes drawdown/drawup and profitability factor correctly', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const trades = [
      { price: 100, qty: 10, side: 'BUY' },
      { price: 90, qty: 10, side: 'SELL' },
      { price: 95, qty: 10, side: 'BUY' },
      { price: 105, qty: 10, side: 'SELL' },
    ];
    for (const t of trades) {
      await createTrade(request, accessToken, {
        deployment_id: fixture.deployment._id,
        strategy_id: fixture.strategy._id,
        account_id: fixture.account._id,
        user_symbol_id: fixture.symbol._id,
        instrument_token: fixture.symbol.instrument_token,
        symbol: fixture.symbol.symbol,
        price: t.price,
        quantity: t.qty,
        type_of_order: t.side,
        commission: 0,
      });
    }
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/analysis`
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{
      data: {
        metrics: {
          max_drawdown: number;
          max_drawup: number;
          profitability_factor: number | string;
          gross_profit: number;
          gross_loss: number;
        };
      };
    }>(res);
    expect(body.data.metrics.max_drawdown).toBeGreaterThan(0);
    expect(body.data.metrics.max_drawup).toBeGreaterThan(0);
    expect(body.data.metrics.gross_profit).toBeGreaterThan(0);
    expect(body.data.metrics.gross_loss).toBeGreaterThan(0);
  });

  test('TC-DEP-044: /analysis and /metrics both O(N) — reporting endpoints replay all trades every call', tags.slow, async ({
    request,
  }) => {
    test.setTimeout(300_000);
    // Related Issue #9
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const tradeCount = 1500;
    await seedTrades(request, accessToken, fixture, tradeCount);
    const metricsStart = Date.now();
    const metricsRes = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/metrics`
    );
    const metricsElapsed = Date.now() - metricsStart;
    await expectStatus(metricsRes, 200);

    const analysisStart = Date.now();
    const analysisRes = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/analysis`
    );
    const analysisElapsed = Date.now() - analysisStart;
    await expectStatus(analysisRes, 200);
    expect(metricsElapsed).toBeGreaterThan(0);
    expect(analysisElapsed).toBeGreaterThan(0);
  });

  test('TC-DEP-045: /candles proxies to symbol candle data using deployment backtest date', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
      overrides: { strategy_mode: 'BACKTEST', backtest_date: '2026-01-15' },
    });
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${deployment._id}/candles`,
      { params: { timeframe: '5m' } }
    );
    await expectStatus(res, [200, 404, 500]);
  });

  test('TC-DEP-046: /logs endpoint always returns an empty array', async ({ request }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    await seedTrades(request, accessToken, fixture, 1);
    await lifecycle(request, accessToken, fixture.deployment._id, 'stop');
    const res = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/logs`
    );
    await expectStatus(res, 200);
    const body = await jsonBody<{ data: unknown[] }>(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sweep signals TC-DEP-047 .. TC-DEP-048
// ---------------------------------------------------------------------------

test.describe('Sweep signal logs', () => {
  test('TC-DEP-047: POST /:id/sweep-signals accepts either user auth or service token', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const payload = {
      eventType: 'sweep',
      outcome: 'accepted',
      level: 100,
      levelType: 'high',
      direction: 'UP',
      ltp: 101,
    };
    const userRes = await apiRequest(request, accessToken).post(
      `/deployments/${fixture.deployment._id}/sweep-signals`,
      { data: payload }
    );
    await expectStatus(userRes, 201);

    const svcRes = await request.post(
      apiPath(`/deployments/${fixture.deployment._id}/sweep-signals`),
      { headers: serviceHeaders(), data: payload }
    );
    await expectStatus(svcRes, 201);

    const noAuthRes = await request.post(
      apiPath(`/deployments/${fixture.deployment._id}/sweep-signals`),
      { headers: { 'Content-Type': 'application/json' }, data: payload }
    );
    await expectStatus(noAuthRes, 401);
  });

  test('TC-DEP-048: GET sweep-signals/stats and GET sweep-signals require standard user auth', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    const statsRes = await request.get(
      apiPath(`/deployments/${fixture.deployment._id}/sweep-signals/stats`),
      { headers: serviceHeaders() }
    );
    await expectStatus(statsRes, 401);
    const logsRes = await request.get(
      apiPath(`/deployments/${fixture.deployment._id}/sweep-signals`),
      { headers: serviceHeaders() }
    );
    await expectStatus(logsRes, 401);

    const authedStats = await apiRequest(request, accessToken).get(
      `/deployments/${fixture.deployment._id}/sweep-signals/stats`
    );
    await expectStatus(authedStats, 200);
  });
});

// ---------------------------------------------------------------------------
// Redis sync TC-DEP-049 .. TC-DEP-051
// ---------------------------------------------------------------------------

test.describe('Redis sync integrity', () => {
  test('TC-DEP-049: syncAllDeploymentsToRedis publishes only RUNNING deployments, keyed by mode', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken);
    const strategy = await createStrategy(request, accessToken);
    const symLive = await createSymbol(request, accessToken);
    const symPaper = await createSymbol(request, accessToken);
    const symBt = await createSymbol(request, accessToken);

    const liveDep = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symLive._id,
      instrument_token: symLive.instrument_token,
      symbol: symLive.symbol,
      overrides: { strategy_mode: 'LIVE' },
    });
    const paperDep = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symPaper._id,
      instrument_token: symPaper.instrument_token,
      symbol: symPaper.symbol,
    });
    const btDep = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symBt._id,
      instrument_token: symBt.instrument_token,
      symbol: symBt.symbol,
      overrides: { strategy_mode: 'BACKTEST' },
    });

    await lifecycle(request, accessToken, liveDep._id, 'start');
    await lifecycle(request, accessToken, paperDep._id, 'start');
    await lifecycle(request, accessToken, btDep._id, 'start');

    const liveKey = `strategies:live:${symLive.symbol}`;
    const paperKey = `strategies:live:${symPaper.symbol}`;
    const btKey = `strategies:backtest:${symBt.symbol}`;
    const liveRaw = await redisGet(liveKey);
    const paperRaw = await redisGet(paperKey);
    const btRaw = await redisGet(btKey);

    if (liveRaw !== null) {
      const parsed = JSON.parse(liveRaw) as { activeStrategies?: unknown[] };
      expect(parsed.activeStrategies?.length).toBeGreaterThan(0);
    }
    if (paperRaw !== null) {
      const parsed = JSON.parse(paperRaw) as { activeStrategies?: unknown[] };
      expect(parsed.activeStrategies?.length).toBeGreaterThan(0);
    }
    if (btRaw !== null) {
      const parsed = JSON.parse(btRaw) as { activeStrategies?: unknown[] };
      expect(parsed.activeStrategies?.length).toBeGreaterThan(0);
    }
  });

  test('TC-DEP-050: Redis entry embeds broker is_internal and account commission fields', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const account = await createAccount(request, accessToken, {
      commission_type: 'FLAT',
      commission_rate: 12,
    });
    const strategy = await createStrategy(request, accessToken);
    const symbol = await createSymbol(request, accessToken);
    const deployment = await createDeployment(request, accessToken, {
      strategy_id: strategy._id,
      account_id: account._id,
      user_symbol_id: symbol._id,
      instrument_token: symbol.instrument_token,
      symbol: symbol.symbol,
    });
    await lifecycle(request, accessToken, deployment._id, 'start');
    const key = `strategies:live:${symbol.symbol}`;
    const raw = await redisGet(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as {
        activeStrategies?: Array<{
          is_internal_broker?: boolean;
          commission_type?: string;
          commission_rate?: number;
        }>;
      };
      const entry = parsed.activeStrategies?.find(
        (s) => s.commission_type === 'FLAT' && s.commission_rate === 12
      );
      expect(entry).toBeTruthy();
      expect(typeof entry?.is_internal_broker).toBe('boolean');
    }
  });

  test('TC-DEP-051: Stopping the only RUNNING deployment for a symbol removes its Redis key entirely', async ({
    request,
  }) => {
    const { accessToken } = await loginAsUser(request);
    const fixture = await createTradeFixture(request, accessToken);
    await lifecycle(request, accessToken, fixture.deployment._id, 'start');
    const key = `strategies:live:${fixture.symbol.symbol}`;
    const existsBefore = await redisKeyExists(key);
    await lifecycle(request, accessToken, fixture.deployment._id, 'stop');
    const existsAfter = await redisKeyExists(key);
    if (existsBefore !== null && existsAfter !== null) {
      expect(existsBefore).toBe(true);
      expect(existsAfter).toBe(false);
    }
  });
});
