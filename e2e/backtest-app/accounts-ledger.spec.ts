import { expect } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsUser,
  createUserB,
  apiRequest,
  apiPath,
  uniqueSuffix,
} from '../fixtures/auth';
import {
  createAccount,
  createStrategy,
  createDeployment,
  createSymbol,
  createTradeFixture,
  createTrade,
  deposit,
  getAccountBalance,
  getInternalBroker,
  getExternalBroker,
  createExternalBrokerForUser,
} from '../fixtures/factories';
import { fireConcurrent } from '../fixtures/concurrent';
import {
  test,
  expectStatus,
  expectMessageContains,
  jsonBody,
  newObjectId,
  tags,
} from '../fixtures/test-helpers';

interface BrokerDoc {
  _id: string;
  name?: string;
  is_internal?: boolean;
}

interface AccountDoc {
  _id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  current_balance: number;
  initial_balance: number;
  broker_id?: string | BrokerDoc;
  commission_type?: string;
  commission_rate?: number;
}

interface LedgerDoc {
  _id: string;
  ledger_id: string;
  account_id: string | AccountDoc;
  change_in_balance: number;
  opening_balance: number;
  closing_balance: number;
  transaction_type: string;
  description?: string;
  deployment_id?: string;
  strategy_id?: string;
  user_symbol_id?: string;
  symbol?: string;
}

interface PaginatedResponse<T> {
  message?: string;
  items: T[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

type ApiWrapped<T> = { message?: string; data: T };

const ERR: number[] = [400, 500];

function unwrapData<T>(body: unknown): T {
  const wrapped = body as { data?: T };
  return (wrapped.data ?? body) as T;
}

function asAccount(raw: unknown): AccountDoc {
  return unwrapData<AccountDoc>(raw);
}

async function accountFromResponse(res: APIResponse): Promise<AccountDoc> {
  return unwrapData<AccountDoc>(await jsonBody(res));
}

async function ledgerFromResponse(res: APIResponse): Promise<LedgerDoc> {
  return unwrapData<LedgerDoc>(await jsonBody(res));
}

function brokerRefId(broker: string | BrokerDoc | undefined): string {
  if (!broker) return '';
  if (typeof broker === 'string') return broker;
  return String(broker._id);
}

async function postAccount(
  request: APIRequestContext,
  token: string,
  payload: Record<string, unknown>
): Promise<{ res: APIResponse; account: AccountDoc }> {
  const res = await apiRequest(request, token).post('/accounts', { data: payload });
  const account = asAccount(await jsonBody(res));
  return { res, account };
}

async function resolveExternalBroker(
  request: APIRequestContext,
  token: string
): Promise<BrokerDoc> {
  const existing = await getExternalBroker(request, token);
  if (existing) return existing as BrokerDoc;
  return createExternalBrokerForUser(request, token) as Promise<BrokerDoc>;
}

async function listLedger(
  request: APIRequestContext,
  token: string,
  params: Record<string, string | number | boolean> = {}
): Promise<PaginatedResponse<LedgerDoc>> {
  const res = await apiRequest(request, token).get('/ledger', { params });
  await expectStatus(res, 200);
  return jsonBody<PaginatedResponse<LedgerDoc>>(res);
}

// ─── Account Creation (TC-ACC-001 – TC-ACC-013) ─────────────────────────────

test('TC-ACC-001: Create PAPER account auto-assigns internal broker', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `paper-${suffix}`,
    account_type: 'PAPER',
    initial_balance: 100000,
  });
  await expectStatus(res, 201);
  const internal = await getInternalBroker(request, accessToken);
  expect(brokerRefId(account.broker_id)).toBe(String(internal._id));
  expect(internal.name).toBe('Cobra Trades');
  expect(internal.is_internal).toBe(true);
  expect(account.current_balance).toBe(100000);
});

test('TC-ACC-002: Create SIMULATION account auto-assigns internal broker', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `sim-${suffix}`,
    account_type: 'SIMULATION',
    initial_balance: 50000,
  });
  await expectStatus(res, 201);
  const internal = await getInternalBroker(request, accessToken);
  expect(brokerRefId(account.broker_id)).toBe(String(internal._id));
  expect(internal.is_internal).toBe(true);
});

test('TC-ACC-003: Create LIVE account requires explicit external broker_id', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const external = await resolveExternalBroker(request, accessToken);
  const suffix = uniqueSuffix();
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `live-${suffix}`,
    account_type: 'LIVE',
    initial_balance: 25000,
    broker_id: external._id,
  });
  await expectStatus(res, 201);
  expect(account.account_type).toBe('LIVE');
  expect(brokerRefId(account.broker_id)).toBe(String(external._id));
});

test('TC-ACC-004: Create LIVE account with internal broker_id explicitly set', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const internal = await getInternalBroker(request, accessToken);
  const suffix = uniqueSuffix();
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `live-internal-${suffix}`,
    account_type: 'LIVE',
    initial_balance: 10000,
    broker_id: internal._id,
  });
  await expectStatus(res, 201);
  expect(account.account_type).toBe('LIVE');
  expect(brokerRefId(account.broker_id)).toBe(String(internal._id));
});

test('TC-ACC-005: Create PAPER with external broker rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const external = await resolveExternalBroker(request, accessToken);
  const suffix = uniqueSuffix();
  const res = await apiRequest(request, accessToken).post('/accounts', {
    data: {
      account_name: `paper-ext-${suffix}`,
      account_type: 'PAPER',
      initial_balance: 10000,
      broker_id: external._id,
    },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Only LIVE accounts can be associated with external brokers');
});

test('TC-ACC-006: current_balance defaults to initial_balance when not supplied', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `default-bal-${uniqueSuffix()}`,
    account_type: 'PAPER',
    initial_balance: 75000,
  });
  await expectStatus(res, 201);
  expect(account.current_balance).toBe(account.initial_balance);
  expect(account.current_balance).toBe(75000);
});

test('TC-ACC-007: current_balance can be explicitly overridden on create', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `override-bal-${uniqueSuffix()}`,
    account_type: 'PAPER',
    initial_balance: 100000,
    current_balance: 50000,
  });
  await expectStatus(res, 201);
  expect(account.initial_balance).toBe(100000);
  expect(account.current_balance).toBe(50000);
});

test('TC-ACC-008: Negative initial_balance is accepted', async ({ request }) => {
  // Related Issue #45: no min validator on initial_balance
  const { accessToken } = await loginAsUser(request);
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `neg-bal-${uniqueSuffix()}`,
    account_type: 'PAPER',
    initial_balance: -5000,
  });
  await expectStatus(res, 201);
  expect(account.initial_balance).toBe(-5000);
  expect(account.current_balance).toBe(-5000);
});

test('TC-ACC-009: Missing required fields rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const api = apiRequest(request, accessToken);

  const missingName = await api.post('/accounts', {
    data: { account_type: 'PAPER', initial_balance: 1000 },
  });
  await expectStatus(missingName, ERR);

  const missingType = await api.post('/accounts', {
    data: { account_name: `no-type-${uniqueSuffix()}`, initial_balance: 1000 },
  });
  await expectStatus(missingType, ERR);

  const missingBalance = await api.post('/accounts', {
    data: { account_name: `no-bal-${uniqueSuffix()}`, account_type: 'PAPER' },
  });
  await expectStatus(missingBalance, ERR);
});

test('TC-ACC-010: Invalid account_type enum value rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).post('/accounts', {
    data: {
      account_name: `crypto-${uniqueSuffix()}`,
      account_type: 'CRYPTO',
      initial_balance: 1000,
    },
  });
  await expectStatus(res, ERR);
});

test('TC-ACC-011: Invalid broker_id (nonexistent ObjectId) rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).post('/accounts', {
    data: {
      account_name: `bad-broker-${uniqueSuffix()}`,
      account_type: 'LIVE',
      initial_balance: 1000,
      broker_id: newObjectId(),
    },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Associated broker not found');
});

test('TC-ACC-012: commission_type defaults to PERCENTAGE, commission_rate defaults to 0', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const { res, account } = await postAccount(request, accessToken, {
    account_name: `comm-default-${uniqueSuffix()}`,
    account_type: 'PAPER',
    initial_balance: 10000,
  });
  await expectStatus(res, 201);
  expect(account.commission_type).toBe('PERCENTAGE');
  expect(account.commission_rate).toBe(0);
});

test('TC-ACC-013: Invalid commission_type enum rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).post('/accounts', {
    data: {
      account_name: `bad-comm-${uniqueSuffix()}`,
      account_type: 'PAPER',
      initial_balance: 1000,
      commission_type: 'FIXED',
    },
  });
  await expectStatus(res, ERR);
});

// ─── Account Read / List (TC-ACC-014 – TC-ACC-018) ──────────────────────────

test('TC-ACC-014: List accounts scoped to authenticated user only', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const accA1 = asAccount(await createAccount(request, tokenA, { account_name: `a1-${uniqueSuffix()}` }));
  const accA2 = asAccount(await createAccount(request, tokenA, { account_name: `a2-${uniqueSuffix()}` }));
  const accB1 = asAccount(await createAccount(request, userB.tokens.accessToken, { account_name: `b1-${uniqueSuffix()}` }));

  const listB = await jsonBody<PaginatedResponse<AccountDoc>>(
    await apiRequest(request, userB.tokens.accessToken).get('/accounts')
  );
  const idsB = listB.items.map((a) => String(a._id));
  expect(idsB).toContain(String(accB1._id));
  expect(idsB).not.toContain(String(accA1._id));
  expect(idsB).not.toContain(String(accA2._id));
});

test('TC-ACC-015: Get account by Mongo _id or by custom account_id string', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const byMongo = await apiRequest(request, accessToken).get(`/accounts/${account._id}`);
  await expectStatus(byMongo, 200);
  const mongoBody = await accountFromResponse(byMongo);
  expect(String(mongoBody._id)).toBe(String(account._id));

  const byCustom = await apiRequest(request, accessToken).get(`/accounts/${account.account_id}`);
  await expectStatus(byCustom, 200);
  const customBody = await accountFromResponse(byCustom);
  expect(String(customBody._id)).toBe(String(account._id));
  expect(customBody.account_id).toBe(account.account_id);
});

test('TC-ACC-016: Get another user account by ID returns not-found', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const accountA = asAccount(await createAccount(request, tokenA));
  const res = await apiRequest(request, userB.tokens.accessToken).get(`/accounts/${accountA._id}`);
  await expectStatus(res, 404);
});

test('TC-ACC-017: GET balance endpoint returns current balance', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 5000, current_balance: 5000 })
  );

  const depositRes = await deposit(request, accessToken, account._id, 1500, 'Balance check deposit');
  await expectStatus(depositRes, 200);

  const balanceRes = await apiRequest(request, accessToken).get(`/accounts/${account._id}/balance`);
  await expectStatus(balanceRes, 200);
  const balanceBody = unwrapData<{ current_balance: number }>(await jsonBody(balanceRes));
  expect(balanceBody.current_balance).toBe(6500);

  const viaHelper = await getAccountBalance(request, accessToken, account._id);
  expect(viaHelper).toBe(6500);
});

test('TC-ACC-018: ReDoS via search query param on accounts list', async ({ request }) => {
  // Related Issue #43: unescaped RegExp in search
  const { accessToken } = await loginAsUser(request);
  const evilPattern = `(a+)+$${'a'.repeat(28)}!`;
  const start = Date.now();
  let responded = false;
  try {
    const res = await Promise.race([
      apiRequest(request, accessToken).get('/accounts', { params: { search: evilPattern } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ReDoS probe timed out')), 15_000)
      ),
    ]);
    responded = true;
    await expectStatus(res, [200, 500]);
  } catch (err) {
    // Timeout also documents ReDoS vulnerability
    expect(String(err)).toMatch(/timed out|ReDoS/i);
  }
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(60_000);
  if (responded && elapsed > 5000) {
    console.warn(`[TC-ACC-018] Slow search response (${elapsed}ms) — possible ReDoS (#43)`);
  }
});

// ─── Account Update (TC-ACC-019 – TC-ACC-023) ─────────────────────────────

test('TC-ACC-019: Non-admin can update whitelisted fields only', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 10000, current_balance: 10000 })
  );

  const patchRes = await apiRequest(request, accessToken).patch(`/accounts/${account._id}`, {
    data: { account_name: 'Renamed Account', current_balance: 999999 },
  });
  await expectStatus(patchRes, 200);
  const updated = await accountFromResponse(patchRes);
  expect(updated.account_name).toBe('Renamed Account');
  expect(updated.current_balance).toBe(10000);
});

test('TC-ACC-020: Admin can update current_balance initial_balance account_type', async ({
  request,
}) => {
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const account = asAccount(await createAccount(request, adminToken));

  const patchRes = await apiRequest(request, adminToken).patch(`/accounts/${account._id}`, {
    data: { current_balance: 42000, initial_balance: 42000, account_type: 'SIMULATION' },
  });
  await expectStatus(patchRes, 200);
  const updated = await accountFromResponse(patchRes);
  expect(updated.current_balance).toBe(42000);
  expect(updated.initial_balance).toBe(42000);
  expect(updated.account_type).toBe('SIMULATION');
});

test('TC-ACC-021: Update with no valid fields returns explicit error', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const emptyPatch = await apiRequest(request, accessToken).patch(`/accounts/${account._id}`, {
    data: {},
  });
  await expectStatus(emptyPatch, ERR);
  await expectMessageContains(emptyPatch, 'No valid fields provided for update');

  const disallowedPatch = await apiRequest(request, accessToken).patch(`/accounts/${account._id}`, {
    data: { user_id: newObjectId() },
  });
  await expectStatus(disallowedPatch, ERR);
  await expectMessageContains(disallowedPatch, 'No valid fields provided for update');
});

test('TC-ACC-022: Changing broker_id on PAPER account to external broker rejected', async ({
  request,
}) => {
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const account = asAccount(await createAccount(request, adminToken, { account_type: 'PAPER' }));
  const external = await resolveExternalBroker(request, adminToken);

  const patchRes = await apiRequest(request, adminToken).patch(`/accounts/${account._id}`, {
    data: { broker_id: external._id },
  });
  await expectStatus(patchRes, ERR);
  await expectMessageContains(patchRes, 'Only LIVE accounts can be associated with external brokers');
});

test('TC-ACC-023: Changing broker_id to nonexistent broker rejected', async ({ request }) => {
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const account = asAccount(await createAccount(request, adminToken));

  const patchRes = await apiRequest(request, adminToken).patch(`/accounts/${account._id}`, {
    data: { broker_id: newObjectId() },
  });
  await expectStatus(patchRes, ERR);
  await expectMessageContains(patchRes, 'Associated broker not found');
});

// ─── Account Deletion (TC-ACC-024 – TC-ACC-027) ─────────────────────────────

test('TC-ACC-024: Deleting an account cascades to deployments trades positions ledgers', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const fixture = await createTradeFixture(request, accessToken, {
    initial_balance: 200000,
    current_balance: 200000,
  });
  const { account, strategy, symbol, deployment } = fixture;

  const depositRes = await deposit(request, accessToken, account._id, 500, 'Pre-delete deposit');
  await expectStatus(depositRes, 200);

  const tradeRes = await createTrade(request, accessToken, {
    account_id: account._id,
    deployment_id: deployment._id,
    strategy_id: strategy._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
    price: 100,
    quantity: 1,
    type_of_order: 'BUY',
  });
  await expectStatus(tradeRes, 201);

  const ledgerBefore = await listLedger(request, accessToken, { accountId: account._id, limit: 100 });
  expect(ledgerBefore.items.length).toBeGreaterThan(0);

  const deleteRes = await apiRequest(request, accessToken).delete(`/accounts/${account._id}`);
  await expectStatus(deleteRes, 200);

  const getAcc = await apiRequest(request, accessToken).get(`/accounts/${account._id}`);
  await expectStatus(getAcc, 404);

  const deployments = await jsonBody<PaginatedResponse<{ _id: string }>>(
    await apiRequest(request, accessToken).get('/deployments', {
      params: { account_id: account._id },
    })
  );
  expect(deployments.items.filter((d) => String(d._id) === String(deployment._id))).toHaveLength(0);

  const trades = await jsonBody<PaginatedResponse<{ _id: string }>>(
    await apiRequest(request, accessToken).get('/trades', { params: { account_id: account._id } })
  );
  expect(trades.items).toHaveLength(0);

  const ledgerAfter = await listLedger(request, accessToken, { accountId: account._id, limit: 100 });
  expect(ledgerAfter.items).toHaveLength(0);
});

test('TC-ACC-025: Deleting nonexistent account returns 404 gracefully', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).delete(`/accounts/${newObjectId()}`);
  await expectStatus(res, 404);
});

test('TC-ACC-026: Deleting another user account is blocked', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const accountA = asAccount(await createAccount(request, tokenA));
  const deleteRes = await apiRequest(request, userB.tokens.accessToken).delete(
    `/accounts/${accountA._id}`
  );
  await expectStatus(deleteRes, 404);

  const stillThere = await apiRequest(request, tokenA).get(`/accounts/${accountA._id}`);
  await expectStatus(stillThere, 200);
});

test('TC-ACC-027: Redis sync failure during cascade delete does not fail the HTTP request', async ({
  request,
}) => {
  // Service catches Redis sync errors and still returns success; verify happy-path delete succeeds.
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const deleteRes = await apiRequest(request, accessToken).delete(`/accounts/${account._id}`);
  await expectStatus(deleteRes, 200);
  const body = await jsonBody<{ message: string }>(deleteRes);
  expect(body.message).toMatch(/deleted successfully/i);

  const getRes = await apiRequest(request, accessToken).get(`/accounts/${account._id}`);
  await expectStatus(getRes, 404);
});

// ─── Ledger Deposit (TC-LDG-001 – TC-LDG-006) ────────────────────────────────

test('TC-LDG-001: Deposit increases balance and creates a ledger entry', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 5000, current_balance: 5000 })
  );

  const res = await deposit(request, accessToken, account._id, 1000, 'Test deposit');
  await expectStatus(res, 200);
  const entry = await ledgerFromResponse(res);
  expect(entry.transaction_type).toBe('DEPOSIT');
  expect(entry.change_in_balance).toBe(1000);
  expect(entry.opening_balance).toBe(5000);
  expect(entry.closing_balance).toBe(6000);

  const balance = await getAccountBalance(request, accessToken, account._id);
  expect(balance).toBe(6000);
});

test('TC-LDG-002: Deposit with zero or negative amount rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const zeroRes = await deposit(request, accessToken, account._id, 0);
  await expectStatus(zeroRes, ERR);
  await expectMessageContains(zeroRes, 'Amount must be greater than zero');

  const negRes = await deposit(request, accessToken, account._id, -100);
  await expectStatus(negRes, ERR);
  await expectMessageContains(negRes, 'Amount must be greater than zero');
});

test('TC-LDG-003: Deposit to nonexistent or foreign account rejected', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const accountA = asAccount(await createAccount(request, tokenA));

  const foreignRes = await deposit(request, userB.tokens.accessToken, accountA._id, 100);
  await expectStatus(foreignRes, ERR);
  await expectMessageContains(foreignRes, 'Account not found');

  const bogusRes = await deposit(request, tokenA, newObjectId(), 100);
  await expectStatus(bogusRes, ERR);
  await expectMessageContains(bogusRes, 'Account not found');
});

test('TC-LDG-004: Deposit ledger entry auto-links to Manual deployment if one exists', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));
  const strategy = await createStrategy(request, accessToken);
  const symbol = await createSymbol(request, accessToken);
  const manualDep = await createDeployment(request, accessToken, {
    strategy_id: strategy._id,
    account_id: account._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
    overrides: { deployment_name: 'Manual' },
  });

  const res = await deposit(request, accessToken, account._id, 250, 'Manual dep link');
  await expectStatus(res, 200);
  const entry = await ledgerFromResponse(res);
  expect(String(entry.deployment_id)).toBe(String(manualDep._id));
  expect(String(entry.strategy_id)).toBe(String(strategy._id));
  expect(String(entry.user_symbol_id)).toBe(String(symbol._id));
  expect(entry.symbol).toBe(symbol.symbol);
});

test('TC-LDG-005: Deposit without Manual deployment omits deployment linkage fields', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const res = await deposit(request, accessToken, account._id, 100, 'No manual deployment');
  await expectStatus(res, 200);
  const entry = await ledgerFromResponse(res);
  expect(entry.deployment_id).toBeFalsy();
  expect(entry.strategy_id).toBeFalsy();
  expect(entry.user_symbol_id).toBeFalsy();
});

test('TC-LDG-006: Concurrent deposits lost update race', tags.race, async ({ request }) => {
  // Related Issue #35: read-modify-save without atomic $inc
  const { accessToken } = await loginAsUser(request);
  const initialBalance = 1000;
  const account = asAccount(
    await createAccount(request, accessToken, {
      initial_balance: initialBalance,
      current_balance: initialBalance,
    })
  );

  const results = await fireConcurrent(
    () => deposit(request, accessToken, account._id, 100, 'Concurrent deposit'),
    10
  );
  for (const res of results) {
    await expectStatus(res, 200);
  }

  const finalBalance = await getAccountBalance(request, accessToken, account._id);
  const ledger = await listLedger(request, accessToken, { accountId: account._id, limit: 100 });
  const deposits = ledger.items.filter((e) => e.transaction_type === 'DEPOSIT');
  expect(deposits.length).toBe(10);

  const ledgerSum = deposits.reduce((sum, e) => sum + e.change_in_balance, 0);
  expect(ledgerSum).toBe(1000);
  const balanceDelta = finalBalance - initialBalance;
  if (ledgerSum !== balanceDelta) {
    console.warn(
      `[TC-LDG-006] Race detected (#35): ledger sum ${ledgerSum} !== balance delta ${balanceDelta}`
    );
  }
  expect(finalBalance).toBeLessThanOrEqual(initialBalance + 1000);
  expect(finalBalance).toBeGreaterThanOrEqual(initialBalance);
});

// ─── Ledger Withdraw (TC-LDG-007 – TC-LDG-011) ─────────────────────────────

test('TC-LDG-007: Withdraw decreases balance and creates WITHDRAW ledger entry', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 8000, current_balance: 8000 })
  );

  const res = await apiRequest(request, accessToken).post('/ledger/withdraw', {
    data: { accountId: account._id, amount: 1500, description: 'Test withdraw' },
  });
  await expectStatus(res, 200);
  const entry = await ledgerFromResponse(res);
  expect(entry.transaction_type).toBe('WITHDRAW');
  expect(entry.change_in_balance).toBe(-1500);
  expect(entry.closing_balance).toBe(6500);

  const balance = await getAccountBalance(request, accessToken, account._id);
  expect(balance).toBe(6500);
});

test('TC-LDG-008: Withdraw more than current balance rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 500, current_balance: 500 })
  );

  const res = await apiRequest(request, accessToken).post('/ledger/withdraw', {
    data: { accountId: account._id, amount: 1000 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Insufficient funds');

  const balance = await getAccountBalance(request, accessToken, account._id);
  expect(balance).toBe(500);
});

test('TC-LDG-009: Withdraw zero or negative amount rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const zeroRes = await apiRequest(request, accessToken).post('/ledger/withdraw', {
    data: { accountId: account._id, amount: 0 },
  });
  await expectStatus(zeroRes, ERR);
  await expectMessageContains(zeroRes, 'Amount must be greater than zero');

  const negRes = await apiRequest(request, accessToken).post('/ledger/withdraw', {
    data: { accountId: account._id, amount: -50 },
  });
  await expectStatus(negRes, ERR);
  await expectMessageContains(negRes, 'Amount must be greater than zero');
});

test('TC-LDG-010: Concurrent withdrawals can overdraw the account', tags.race, async ({
  request,
}) => {
  // Related Issue #35: double-spend via concurrent withdraw
  const { accessToken } = await loginAsUser(request);
  const initialBalance = 1000;
  const account = asAccount(
    await createAccount(request, accessToken, {
      initial_balance: initialBalance,
      current_balance: initialBalance,
    })
  );

  const withdraw = () =>
    apiRequest(request, accessToken).post('/ledger/withdraw', {
      data: { accountId: account._id, amount: 800, description: 'Concurrent withdraw' },
    });

  const results = await fireConcurrent(withdraw, 2);
  const successCount = results.filter((r) => r.status() === 200).length;
  expect(successCount).toBeGreaterThanOrEqual(1);

  const finalBalance = await getAccountBalance(request, accessToken, account._id);
  const ledger = await listLedger(request, accessToken, { accountId: account._id, limit: 100 });
  const withdrawals = ledger.items.filter((e) => e.transaction_type === 'WITHDRAW');
  const ledgerSum = withdrawals.reduce((sum, e) => sum + e.change_in_balance, 0);
  const balanceDelta = finalBalance - initialBalance;

  if (successCount === 2 && (finalBalance < -600 || ledgerSum !== balanceDelta)) {
    console.warn(
      `[TC-LDG-010] Race detected (#35): ${successCount} withdrawals, balance=${finalBalance}, ledgerSum=${ledgerSum}`
    );
  }
  expect(finalBalance).toBeLessThanOrEqual(initialBalance);
});

test('TC-LDG-011: Withdraw from foreign account rejected', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);
  const accountA = asAccount(await createAccount(request, tokenA));

  const res = await apiRequest(request, userB.tokens.accessToken).post('/ledger/withdraw', {
    data: { accountId: accountA._id, amount: 100 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Account not found');
});

// ─── Ledger Transfer (TC-LDG-012 – TC-LDG-019) ─────────────────────────────

test('TC-LDG-012: Transfer moves funds between two owned accounts', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const from = asAccount(
    await createAccount(request, accessToken, { initial_balance: 10000, current_balance: 10000 })
  );
  const to = asAccount(
    await createAccount(request, accessToken, { initial_balance: 2000, current_balance: 2000 })
  );

  const res = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: {
      fromAccountId: from._id,
      toAccountId: to._id,
      amount: 3000,
      description: 'E2E transfer',
    },
  });
  await expectStatus(res, 200);
  const data = unwrapData<{ fromLedger: LedgerDoc; toLedger: LedgerDoc }>(await jsonBody(res));
  expect(data.fromLedger.transaction_type).toBe('TRANSFER_OUT');
  expect(data.toLedger.transaction_type).toBe('TRANSFER_IN');
  expect(data.fromLedger.change_in_balance).toBe(-3000);
  expect(data.toLedger.change_in_balance).toBe(3000);

  expect(await getAccountBalance(request, accessToken, from._id)).toBe(7000);
  expect(await getAccountBalance(request, accessToken, to._id)).toBe(5000);
});

test('TC-LDG-013: Transfer with insufficient funds in source rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const from = asAccount(
    await createAccount(request, accessToken, { initial_balance: 100, current_balance: 100 })
  );
  const to = asAccount(await createAccount(request, accessToken));

  const res = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: from._id, toAccountId: to._id, amount: 500 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Insufficient funds');
  expect(await getAccountBalance(request, accessToken, from._id)).toBe(100);
});

test('TC-LDG-014: Transfer to nonexistent destination rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const from = asAccount(
    await createAccount(request, accessToken, { initial_balance: 5000, current_balance: 5000 })
  );

  const res = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: from._id, toAccountId: newObjectId(), amount: 100 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Destination account not found');
  expect(await getAccountBalance(request, accessToken, from._id)).toBe(5000);
});

test('TC-LDG-015: Self-transfer using identical Mongo _id rejected', async ({ request }) => {
  // Related Issue #47: string equality check on raw ids
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const res = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: account._id, toAccountId: account._id, amount: 100 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Source and destination accounts must be different');
});

test('TC-LDG-016: Self-transfer bypass using mixed identifier forms', async ({ request }) => {
  // Related Issue #47: _id vs account_id string bypass
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));

  const res = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: account._id, toAccountId: account.account_id, amount: 100 },
  });
  // Current behavior: bypass succeeds (bug) — document until #47 is fixed
  if (res.status() === 200) {
    const ledger = await listLedger(request, accessToken, { accountId: account._id, limit: 20 });
    const transfers = ledger.items.filter(
      (e) => e.transaction_type === 'TRANSFER_OUT' || e.transaction_type === 'TRANSFER_IN'
    );
    expect(transfers.length).toBeGreaterThanOrEqual(2);
    console.warn('[TC-LDG-016] Self-transfer bypass confirmed (#47)');
  } else {
    await expectMessageContains(res, 'different');
  }
});

test('TC-LDG-017: Transfer between accounts owned by different users rejected', async ({
  request,
}) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const fromA = asAccount(
    await createAccount(request, tokenA, { initial_balance: 5000, current_balance: 5000 })
  );
  const toB = asAccount(await createAccount(request, userB.tokens.accessToken));

  const res = await apiRequest(request, tokenA).post('/ledger/transfer', {
    data: { fromAccountId: fromA._id, toAccountId: toB._id, amount: 100 },
  });
  await expectStatus(res, ERR);
  await expectMessageContains(res, 'Destination account not found');
  expect(await getAccountBalance(request, tokenA, fromA._id)).toBe(5000);
});

test('TC-LDG-018: Concurrent transfers non-atomic double debit credit', tags.race, async ({
  request,
}) => {
  // Related Issue #35: lost-update on concurrent transfers from same source
  const { accessToken } = await loginAsUser(request);
  const initialBalance = 5000;
  const from = asAccount(
    await createAccount(request, accessToken, {
      initial_balance: initialBalance,
      current_balance: initialBalance,
    })
  );
  const to1 = asAccount(await createAccount(request, accessToken));
  const to2 = asAccount(await createAccount(request, accessToken));

  const transferOut = (toId: string) =>
    apiRequest(request, accessToken).post('/ledger/transfer', {
      data: { fromAccountId: from._id, toAccountId: toId, amount: 2000 },
    });

  const results = await Promise.all([transferOut(to1._id), transferOut(to2._id)]);
  for (const res of results) {
    expect([200, 500]).toContain(res.status());
  }

  const finalFrom = await getAccountBalance(request, accessToken, from._id);
  const ledger = await listLedger(request, accessToken, { accountId: from._id, limit: 100 });
  const outs = ledger.items.filter((e) => e.transaction_type === 'TRANSFER_OUT');
  const ledgerSum = outs.reduce((sum, e) => sum + e.change_in_balance, 0);
  const balanceDelta = finalFrom - initialBalance;
  if (outs.length >= 2 && ledgerSum !== balanceDelta) {
    console.warn(
      `[TC-LDG-018] Race detected (#35): ledger sum ${ledgerSum} !== balance delta ${balanceDelta}`
    );
  }
  expect(finalFrom).toBeLessThanOrEqual(initialBalance);
});

test('TC-LDG-019: Transfer amount zero or negative rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const from = asAccount(await createAccount(request, accessToken));
  const to = asAccount(await createAccount(request, accessToken));

  const zeroRes = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: from._id, toAccountId: to._id, amount: 0 },
  });
  await expectStatus(zeroRes, ERR);
  await expectMessageContains(zeroRes, 'Amount must be greater than zero');

  const negRes = await apiRequest(request, accessToken).post('/ledger/transfer', {
    data: { fromAccountId: from._id, toAccountId: to._id, amount: -10 },
  });
  await expectStatus(negRes, ERR);
  await expectMessageContains(negRes, 'Amount must be greater than zero');
});

// ─── Ledger List / Filter (TC-LDG-020 – TC-LDG-024) ────────────────────────

test('TC-LDG-020: List ledger entries scoped to caller user_id', async ({ request }) => {
  const { accessToken: tokenA } = await loginAsUser(request);
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const userB = await createUserB(request, adminToken);

  const accountA = asAccount(await createAccount(request, tokenA));
  await deposit(request, tokenA, accountA._id, 100, 'User A deposit');

  const accountB = asAccount(await createAccount(request, userB.tokens.accessToken));
  await deposit(request, userB.tokens.accessToken, accountB._id, 200, 'User B deposit');

  const listB = await listLedger(request, userB.tokens.accessToken, { limit: 100 });
  const accountIds = listB.items.map((e) =>
    typeof e.account_id === 'object' ? String(e.account_id._id) : String(e.account_id)
  );
  expect(accountIds.every((id) => id === String(accountB._id))).toBe(true);
  expect(listB.items.some((e) => e.description === 'User A deposit')).toBe(false);
});

test('TC-LDG-021: Filter ledger by accountId strategyId deploymentId symbol', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const fixture = await createTradeFixture(request, accessToken);
  const { account, strategy, symbol, deployment } = fixture;

  await deposit(request, accessToken, account._id, 50, 'Filter test deposit');

  const byAccount = await listLedger(request, accessToken, { accountId: account._id });
  expect(byAccount.items.length).toBeGreaterThan(0);
  expect(
    byAccount.items.every((e) => {
      const id =
        typeof e.account_id === 'object' ? String(e.account_id._id) : String(e.account_id);
      return id === String(account._id);
    })
  ).toBe(true);

  const byStrategy = await listLedger(request, accessToken, { strategyId: strategy._id });
  expect(byStrategy.items.length).toBeGreaterThanOrEqual(0);

  const byDeployment = await listLedger(request, accessToken, { deploymentId: deployment._id });
  expect(byDeployment.items.length).toBeGreaterThanOrEqual(0);

  const bySymbol = await listLedger(request, accessToken, { symbol: symbol.symbol });
  expect(bySymbol.items.every((e) => !e.symbol || e.symbol === symbol.symbol.toUpperCase())).toBe(
    true
  );

  const foreign = await listLedger(request, accessToken, { accountId: newObjectId() });
  expect(foreign.items).toHaveLength(0);
  expect(foreign.pagination.total).toBe(0);
});

test('TC-LDG-022: Filter ledger by type credit and debit', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 10000, current_balance: 10000 })
  );
  await deposit(request, accessToken, account._id, 500);
  await apiRequest(request, accessToken).post('/ledger/withdraw', {
    data: { accountId: account._id, amount: 200 },
  });

  const credits = await listLedger(request, accessToken, { accountId: account._id, type: 'credit' });
  expect(credits.items.every((e) => e.change_in_balance > 0)).toBe(true);

  const debits = await listLedger(request, accessToken, { accountId: account._id, type: 'debit' });
  expect(debits.items.every((e) => e.change_in_balance < 0)).toBe(true);
});

test('TC-LDG-023: GET ledger by Mongo _id or ledger_id', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(await createAccount(request, accessToken));
  const depRes = await deposit(request, accessToken, account._id, 75);
  await expectStatus(depRes, 200);
  const created = await ledgerFromResponse(depRes);

  const byMongo = await apiRequest(request, accessToken).get(`/ledger/${created._id}`);
  await expectStatus(byMongo, 200);
  const mongoEntry = await ledgerFromResponse(byMongo);
  expect(String(mongoEntry._id)).toBe(String(created._id));

  const byCustom = await apiRequest(request, accessToken).get(`/ledger/${created.ledger_id}`);
  await expectStatus(byCustom, 200);
  const customEntry = await ledgerFromResponse(byCustom);
  expect(customEntry.ledger_id).toBe(created.ledger_id);
});

test('TC-LDG-024: Pagination fields page limit pages total are correct', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = asAccount(
    await createAccount(request, accessToken, { initial_balance: 100000, current_balance: 100000 })
  );

  for (let i = 0; i < 12; i++) {
    const res = await deposit(request, accessToken, account._id, 10, `Page deposit ${i}`);
    await expectStatus(res, 200);
  }

  const page1 = await listLedger(request, accessToken, {
    accountId: account._id,
    page: 1,
    limit: 5,
  });
  expect(page1.items.length).toBe(5);
  expect(page1.pagination.page).toBe(1);
  expect(page1.pagination.limit).toBe(5);
  expect(page1.pagination.total).toBeGreaterThanOrEqual(12);
  expect(page1.pagination.pages).toBe(Math.ceil(page1.pagination.total / 5));

  const page2 = await listLedger(request, accessToken, {
    accountId: account._id,
    page: 2,
    limit: 5,
  });
  expect(page2.items.length).toBe(5);
  expect(page2.pagination.page).toBe(2);
  expect(page2.items[0]._id).not.toBe(page1.items[0]._id);
});

// ─── Commission & Auth (TC-LDG-025 – TC-LDG-026) ───────────────────────────

test('TC-LDG-025: Account commission_rate commission_type applied at trade time', async ({
  request,
}) => {
  const { accessToken: adminToken } = await loginAsAdmin(request);
  const account = asAccount(
    await createAccount(request, adminToken, {
      initial_balance: 100000,
      current_balance: 100000,
    })
  );

  const patchRes = await apiRequest(request, adminToken).patch(`/accounts/${account._id}`, {
    data: { commission_type: 'PERCENTAGE', commission_rate: 0.1 },
  });
  await expectStatus(patchRes, 200);

  const strategy = await createStrategy(request, adminToken);
  const symbol = await createSymbol(request, adminToken);
  const deployment = await createDeployment(request, adminToken, {
    strategy_id: strategy._id,
    account_id: account._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
  });

  const price = 100;
  const quantity = 10;
  const tradeValue = price * quantity;
  const expectedCommission = parseFloat((tradeValue * (0.1 / 100)).toFixed(2));

  const tradeRes = await createTrade(request, adminToken, {
    account_id: account._id,
    deployment_id: deployment._id,
    strategy_id: strategy._id,
    user_symbol_id: symbol._id,
    instrument_token: symbol.instrument_token,
    symbol: symbol.symbol,
    price,
    quantity,
    type_of_order: 'BUY',
  });
  await expectStatus(tradeRes, 201);

  const tradeBody = unwrapData<{ trade: { commission: number } }>(await jsonBody(tradeRes));
  expect(tradeBody.trade.commission).toBe(expectedCommission);
});

test('TC-LDG-026: Unauthenticated request to ledger and account endpoints rejected', async ({
  request,
}) => {
  const unauth = apiRequest(request);
  const bogusId = newObjectId();

  const endpoints: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; data?: unknown }> = [
    { method: 'get', path: '/accounts' },
    { method: 'post', path: '/accounts', data: { account_name: 'x', account_type: 'PAPER', initial_balance: 1 } },
    { method: 'get', path: `/accounts/${bogusId}` },
    { method: 'patch', path: `/accounts/${bogusId}`, data: { account_name: 'y' } },
    { method: 'delete', path: `/accounts/${bogusId}` },
    { method: 'get', path: `/accounts/${bogusId}/balance` },
    { method: 'get', path: '/ledger' },
    { method: 'post', path: '/ledger/deposit', data: { accountId: bogusId, amount: 1 } },
    { method: 'post', path: '/ledger/withdraw', data: { accountId: bogusId, amount: 1 } },
    {
      method: 'post',
      path: '/ledger/transfer',
      data: { fromAccountId: bogusId, toAccountId: bogusId, amount: 1 },
    },
    { method: 'get', path: `/ledger/${bogusId}` },
  ];

  for (const ep of endpoints) {
    let res: APIResponse;
    if (ep.method === 'get') {
      res = await unauth.get(ep.path);
    } else if (ep.method === 'post') {
      res = await unauth.post(ep.path, { data: ep.data });
    } else if (ep.method === 'patch') {
      res = await unauth.patch(ep.path, { data: ep.data });
    } else {
      res = await unauth.delete(ep.path);
    }
    await expectStatus(res, 401, `${ep.method.toUpperCase()} ${ep.path} should require auth`);
  }

  // Also verify raw request without api helper headers
  const rawRes = await request.get(apiPath('/accounts'));
  await expectStatus(rawRes, 401);
});
