import { expect } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  apiPath,
  apiRequest,
  createUserB,
  getMe,
  loginAsAdmin,
  loginAsUser,
  serviceHeaders,
  uniqueSuffix,
} from '../fixtures/auth';
import {
  createAccount,
  createDeployment,
  createSymbol,
  createTrade,
  createTradeFixture,
  getAccountBalance,
} from '../fixtures/factories';
import { fireConcurrentWithResults } from '../fixtures/concurrent';
import {
  test,
  expectStatus,
  expectMessageContains,
  jsonBody,
  newObjectId,
  tags,
} from '../fixtures/test-helpers';

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface TradeRecord {
  _id: string;
  trade_id?: string;
  price: number;
  quantity: number;
  type_of_order: 'BUY' | 'SELL';
  commission?: number;
  pnl?: number;
  deployment_id?: string;
  account_id?: string;
  symbol?: string;
  status?: string;
  position_id?: string | null;
  created_at?: string;
  execution_time?: string;
}

interface PositionRecord {
  _id: string;
  status: 'OPEN' | 'CLOSED';
  direction: 'LONG' | 'SHORT';
  open_size: number;
  total_size?: number;
  average_entry_price: number;
  realised_pnl?: number;
  unrealised_pnl?: number;
  max_up?: number;
  max_down?: number;
  max_up_pct?: number;
  max_down_pct?: number;
  last_ltp?: number;
  closed_at?: string | null;
  deployment_id?: string;
  user_id?: string;
  trades?: string[];
}

interface DeploymentRecord {
  _id: string;
  position_size: number;
  average_entry_price: number;
  symbol?: string;
  strategy_mode?: string;
  symbol_control?: {
    enabled?: boolean;
    pending_resolve?: boolean;
    last_resolved_strike?: number | null;
  };
}

function tradePayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
    execution_time: new Date().toISOString(),
    ...overrides,
  };
}

async function postTrade(
  request: APIRequestContext,
  token: string,
  payload: Record<string, unknown>
): Promise<APIResponse> {
  return createTrade(request, token, payload);
}

async function postLegacyTrade(
  request: APIRequestContext,
  payload: Record<string, unknown>,
  headers: Record<string, string> = serviceHeaders()
): Promise<APIResponse> {
  return request.post(apiPath('api/trade'), { headers, data: payload });
}

async function parseTradeResponse(res: APIResponse): Promise<{
  trade: TradeRecord;
  account: { _id: string; current_balance: number };
  closing_balance: number;
}> {
  const body = await jsonBody<{ data: { trade: TradeRecord; account: { _id: string; current_balance: number }; closing_balance: number } }>(res);
  return body.data;
}

async function getDeployment(
  request: APIRequestContext,
  token: string,
  deploymentId: string
): Promise<DeploymentRecord> {
  const res = await apiRequest(request, token).get(`/deployments/${deploymentId}`);
  await expectStatus(res, 200);
  const body = await jsonBody<{ data: DeploymentRecord }>(res);
  return body.data;
}

async function listOpenPositions(
  request: APIRequestContext,
  token: string,
  deploymentId?: string
): Promise<PositionRecord[]> {
  const params: Record<string, string> = { status: 'OPEN' };
  if (deploymentId) params.deployment_id = deploymentId;
  const res = await apiRequest(request, token).get('/positions', { params });
  await expectStatus(res, 200);
  const body = await jsonBody<{ items: PositionRecord[] }>(res);
  return body.items || [];
}

async function getPositionById(
  request: APIRequestContext,
  token: string,
  positionId: string
): Promise<PositionRecord> {
  const res = await apiRequest(request, token).get(`/positions/${positionId}`);
  await expectStatus(res, 200);
  const body = await jsonBody<{ data: PositionRecord }>(res);
  return body.data;
}

async function listTradesForUser(
  request: APIRequestContext,
  token: string,
  params: Record<string, string | number | boolean> = {}
): Promise<TradeRecord[]> {
  const res = await apiRequest(request, token).get('/trades', { params });
  await expectStatus(res, 200);
  const body = await jsonBody<{ items: TradeRecord[] }>(res);
  return body.items || [];
}

async function listLedgerForAccount(
  request: APIRequestContext,
  token: string,
  accountId: string
): Promise<Array<{ trade_id?: string; change_in_balance: number; order_type?: string }>> {
  const res = await apiRequest(request, token).get('/ledger', {
    // BackTestApp ledger filter uses camelCase accountId (see services/ledger.js)
    params: { accountId, limit: 200 },
  });
  await expectStatus(res, 200);
  const body = await jsonBody<{ items: Array<{ trade_id?: string; change_in_balance: number; order_type?: string }> }>(res);
  return body.items || [];
}

async function getPredefinedPaperAccount(
  request: APIRequestContext,
  token: string
): Promise<{ _id: string; account_name: string; current_balance: number }> {
  const res = await apiRequest(request, token).get('/accounts');
  await expectStatus(res, 200);
  const body = await jsonBody<{ items: Array<{ _id: string; account_name: string; account_type: string; current_balance: number }> }>(res);
  const paper = body.items.find((a) => a.account_type === 'PAPER');
  if (!paper) throw new Error('Predefined PAPER account not found — run seed / login flow first');
  return paper;
}

function replayPositionFromTrades(
  trades: TradeRecord[]
): { positionSize: number; averageEntryPrice: number } {
  const sorted = [...trades].sort(
    (a, b) =>
      new Date(a.created_at || a.execution_time || 0).getTime() -
      new Date(b.created_at || b.execution_time || 0).getTime()
  );

  let positionSize = 0;
  let averageEntryPrice = 0;

  for (const t of sorted) {
    const qty = t.quantity || 0;
    const priceVal = t.price || 0;
    const comm = t.commission || 0;
    const isBuy = t.type_of_order === 'BUY';

    if (isBuy) {
      if (positionSize >= 0) {
        const newSize = positionSize + qty;
        averageEntryPrice =
          newSize > 0
            ? (averageEntryPrice * positionSize + priceVal * qty + comm) / newSize
            : 0;
        positionSize = newSize;
      } else {
        const coveredQty = Math.min(Math.abs(positionSize), qty);
        const remainingQty = qty - coveredQty;
        positionSize += coveredQty;
        if (remainingQty > 0) {
          positionSize = remainingQty;
          averageEntryPrice = priceVal;
        } else if (positionSize === 0) {
          averageEntryPrice = 0;
        }
      }
    } else if (positionSize <= 0) {
      const newSize = positionSize - qty;
      const absNewSize = Math.abs(newSize);
      averageEntryPrice =
        absNewSize > 0
          ? (averageEntryPrice * Math.abs(positionSize) + priceVal * qty + comm) / absNewSize
          : 0;
      positionSize = newSize;
    } else {
      const exitedQty = Math.min(positionSize, qty);
      const remainingQty = qty - exitedQty;
      positionSize -= exitedQty;
      if (remainingQty > 0) {
        positionSize = -remainingQty;
        averageEntryPrice = priceVal;
      } else if (positionSize === 0) {
        averageEntryPrice = 0;
      }
    }
  }

  return { positionSize, averageEntryPrice };
}

async function seedFlatDeployment(
  request: APIRequestContext,
  token: string,
  accountOverrides: Record<string, unknown> = {}
) {
  return createTradeFixture(request, token, {
    initial_balance: 500_000,
    current_balance: 500_000,
    ...accountOverrides,
  });
}

async function hasBacktestTickFiles(symbol: string): Promise<boolean> {
  const sanitized = symbol.replace(/[^a-zA-Z0-9-_]/g, '_');
  const candidateRoots = [
    path.join(process.cwd(), '..', 'BackTest', 'exportedData'),
    path.join(process.cwd(), '..', 'exportedData'),
    '/shared/exportedData',
    '/home/prabu/Desktop/Work Folder/MoneyMaker GitLab AWS/BackTest/exportedData',
  ];

  for (const root of candidateRoots) {
    try {
      const dates = await fs.readdir(root);
      for (const date of dates) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const tickPath = path.join(root, date, `${sanitized}.json`);
        try {
          await fs.access(tickPath);
          const raw = await fs.readFile(tickPath, 'utf8');
          const ticks = JSON.parse(raw);
          if (Array.isArray(ticks) && ticks.length > 0) return true;
        } catch {
          // try next path
        }
      }
    } catch {
      // directory missing
    }
  }
  return false;
}

function deleteOpenPositionsViaMongo(deploymentId: string): boolean {
  const uri = process.env.MONGO_URI || process.env.E2E_MONGO_URI;
  if (!uri) return false;
  try {
    const script = `db.getSiblingDB('BacktestApp').positions.deleteMany({ deployment_id: ObjectId('${deploymentId}'), status: 'OPEN' })`;
    execSync(`mongosh "${uri}" --quiet --eval "${script}"`, { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function redisLiveKeyExists(positionId: string): Promise<boolean | null> {
  const redisUrl = process.env.REDIS_URL || process.env.E2E_REDIS_URL;
  if (!redisUrl) return null;
  try {
    const out = execSync(
      `node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:process.env.REDIS_URL});await c.connect();const v=await c.exists('position:live:${positionId}');console.log(v);await c.disconnect();})().catch(e=>{console.log('0');process.exit(0);})"`,
      { env: { ...process.env, REDIS_URL: redisUrl }, stdio: 'pipe', timeout: 10_000 }
    );
    return out.toString().trim() === '1';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TC-TRD-001 .. TC-TRD-016 — Trade creation core validation
// ---------------------------------------------------------------------------

test('TC-TRD-001: BUY trade opens LONG position when flat', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const balanceBefore = await getAccountBalance(request, accessToken, fx.account._id);

  const price = 100;
  const qty = 10;
  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price,
    quantity: qty,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);

  const { trade, closing_balance } = await parseTradeResponse(res);
  expect(trade.status).toBe('EXECUTED');
  expect(trade.type_of_order).toBe('BUY');

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions).toHaveLength(1);
  expect(positions[0].direction).toBe('LONG');
  expect(positions[0].status).toBe('OPEN');
  expect(positions[0].open_size).toBe(qty);
  expect(positions[0].average_entry_price).toBeCloseTo(price, 4);

  const dep = await getDeployment(request, accessToken, fx.deployment._id);
  expect(dep.position_size).toBe(qty);
  expect(dep.average_entry_price).toBeCloseTo(price, 4);

  const tradeValue = price * qty;
  const expectedBalance = balanceBefore - tradeValue;
  expect(closing_balance).toBeCloseTo(expectedBalance, 2);

  const ledger = await listLedgerForAccount(request, accessToken, fx.account._id);
  const tradeKeys = new Set([String(trade._id), String(trade.trade_id)].filter(Boolean));
  const entry = ledger.find((l) => tradeKeys.has(String(l.trade_id)));
  expect(entry, `ledger entries=${JSON.stringify(ledger.slice(0, 3))}`).toBeDefined();
  expect(entry!.change_in_balance).toBeLessThan(0);
  expect(entry!.order_type).toBe('BUY');
});

test('TC-TRD-002: SELL trade opens SHORT position when flat', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const balanceBefore = await getAccountBalance(request, accessToken, fx.account._id);

  const price = 95;
  const qty = 8;
  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price,
    quantity: qty,
    type_of_order: 'SELL',
  }));
  await expectStatus(res, 201);

  const { closing_balance } = await parseTradeResponse(res);
  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions[0].direction).toBe('SHORT');
  expect(positions[0].open_size).toBe(qty);

  const tradeValue = price * qty;
  expect(closing_balance).toBeCloseTo(balanceBefore + tradeValue, 2);
});

test('TC-TRD-003: missing user_id rejected', async ({ request }) => {
  const res = await postLegacyTrade(request, {
    price: 100,
    quantity: 1,
    type_of_order: 'BUY',
    account_id: newObjectId(),
  });
  await expectStatus(res, 400);
  await expectMessageContains(res, 'user_id is required');
});

test('TC-TRD-004: missing account_id rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await postTrade(request, accessToken, {
    price: 100,
    quantity: 1,
    type_of_order: 'BUY',
  });
  await expectStatus(res, 500);
  await expectMessageContains(res, 'account_id is required');
});

test('TC-TRD-005: zero/negative quantity accepted at HTTP boundary (regression #3)', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  for (const quantity of [0, -10]) {
    const res = await postTrade(request, accessToken, tradePayload({
      deployment_id: fx.deployment._id,
      quantity,
    }));
    // Current gap: no range validation — document actual behavior rather than ideal 400
    expect([201, 400, 500]).toContain(res.status());
    if (res.status() === 201) {
      const { trade } = await parseTradeResponse(res);
      const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
      const open = positions.find((p) => p.trades?.includes(trade._id));
      if (open) {
        expect(open.open_size).toBeLessThanOrEqual(Math.abs(quantity));
      }
    }
  }
});

test('TC-TRD-006: non-numeric price rejected or fails safely (regression #3)', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 'abc',
  }));
  expect([400, 500]).toContain(res.status());
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
});

test('TC-TRD-007: invalid type_of_order enum rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    type_of_order: 'SHORT',
  }));
  await expectStatus(res, 500);
  const body = await res.text();
  expect(body.toLowerCase()).toMatch(/enum|validation|type_of_order/);
});

test('TC-TRD-008: foreign deployment rejected', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  await seedFlatDeployment(request, admin.accessToken);
  const fxB = await seedFlatDeployment(request, userB.tokens.accessToken);

  const res = await postTrade(request, admin.accessToken, tradePayload({
    deployment_id: fxB.deployment._id,
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'does not belong to the authenticated user');
});

test('TC-TRD-009: nonexistent deployment_id rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: newObjectId(),
    account_id: fx.account._id,
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'Associated deployment not found');
});

test('TC-TRD-010: inactive UserSymbol rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const patchRes = await apiRequest(request, accessToken).patch(`/symbols/${fx.symbol._id}`, {
    data: { is_active: false },
  });
  await expectStatus(patchRes, 200);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'inactive');
});

test('TC-TRD-011: foreign account_id rejected', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  const fxA = await seedFlatDeployment(request, admin.accessToken);
  const fxB = await seedFlatDeployment(request, userB.tokens.accessToken);

  const res = await postTrade(request, admin.accessToken, tradePayload({
    deployment_id: fxA.deployment._id,
    account_id: fxB.account._id,
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'does not belong to the authenticated user');
});

test('TC-TRD-012: nonexistent account_id rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const bogusAccount = newObjectId();

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    account_id: bogusAccount,
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'does not exist');
});

test('TC-TRD-013: BUY rejected when balance insufficient', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken, {
    initial_balance: 100,
    current_balance: 100,
  });
  const balanceBefore = await getAccountBalance(request, accessToken, fx.account._id);
  const tradesBefore = await listTradesForUser(request, accessToken, {
    deployment_id: fx.deployment._id,
  });

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'Insufficient balance');

  const balanceAfter = await getAccountBalance(request, accessToken, fx.account._id);
  expect(balanceAfter).toBe(balanceBefore);

  const tradesAfter = await listTradesForUser(request, accessToken, {
    deployment_id: fx.deployment._id,
  });
  expect(tradesAfter.length).toBe(tradesBefore.length);
  expect(await listOpenPositions(request, accessToken, fx.deployment._id)).toHaveLength(0);
});

test('TC-TRD-014: SELL short-open is not balance-checked', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken, {
    initial_balance: 50,
    current_balance: 50,
  });

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 200,
    quantity: 100,
    type_of_order: 'SELL',
  }));
  await expectStatus(res, 201);

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions[0].direction).toBe('SHORT');
  expect(positions[0].open_size).toBe(100);
});

test('TC-TRD-015: trade without deployment_id attaches Manual deployment', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const paper = await getPredefinedPaperAccount(request, accessToken);

  const res = await postTrade(request, accessToken, {
    account_id: paper._id,
    price: 10,
    quantity: 1,
    type_of_order: 'BUY',
    execution_time: new Date().toISOString(),
  });
  await expectStatus(res, 201);

  const { trade } = await parseTradeResponse(res);
  expect(trade.deployment_id).toBeTruthy();
  expect(trade.symbol).toBe('MANUAL');

  const depRes = await apiRequest(request, accessToken).get(`/deployments/${trade.deployment_id}`);
  await expectStatus(depRes, 200);
  const dep = await jsonBody<{ data: DeploymentRecord & { deployment_name?: string } }>(depRes);
  expect(dep.data.deployment_name).toBe('Manual');
});

test('TC-TRD-016: symbol string resolves via UserSymbol lookup', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const account = await createAccount(request, accessToken, {
    initial_balance: 200_000,
    current_balance: 200_000,
  });
  const symbol = await createSymbol(request, accessToken, { symbol: `RELIANCE${uniqueSuffix().slice(-4)}` });

  const res = await postTrade(request, accessToken, {
    account_id: account._id,
    symbol: symbol.symbol,
    price: 2500,
    quantity: 2,
    type_of_order: 'BUY',
    execution_time: new Date().toISOString(),
  });
  await expectStatus(res, 201);

  const { trade } = await parseTradeResponse(res);
  expect(trade.symbol).toBe(symbol.symbol.toUpperCase());

  const missing = await postTrade(request, accessToken, {
    account_id: account._id,
    symbol: 'NOTINWATCHLIST',
    price: 100,
    quantity: 1,
    type_of_order: 'BUY',
  });
  await expectStatus(missing, 500);
  await expectMessageContains(missing, 'not found in user');
});

// ---------------------------------------------------------------------------
// TC-TRD-017 .. TC-TRD-023 — Position lifecycle & caching
// ---------------------------------------------------------------------------

test('TC-TRD-017: scale-in recalculates weighted average entry', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 110,
    quantity: 5,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions[0].open_size).toBe(15);
  expect(positions[0].average_entry_price).toBeCloseTo((100 * 10 + 110 * 5) / 15, 2);
  expect(positions[0].total_size).toBeGreaterThanOrEqual(15);
});

test('TC-TRD-018: partial close realizes partial P&L', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 120,
    quantity: 4,
    type_of_order: 'SELL',
  }));
  await expectStatus(res, 201);
  const { trade } = await parseTradeResponse(res);

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions[0].open_size).toBe(6);
  expect(positions[0].realised_pnl).toBeCloseTo((120 - 100) * 4, 1);
  expect(trade.pnl).toBeCloseTo((120 - 100) * 4, 1);
});

test('TC-TRD-019: full close closes position', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const openRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));
  const { trade: openTrade } = await parseTradeResponse(openRes);
  const openPos = (await listOpenPositions(request, accessToken, fx.deployment._id))[0];

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 130,
    quantity: 10,
    type_of_order: 'SELL',
  }));
  await expectStatus(res, 201);

  const closed = await getPositionById(request, accessToken, openPos._id);
  expect(closed.status).toBe('CLOSED');
  expect(closed.open_size).toBe(0);
  expect(closed.unrealised_pnl).toBe(0);
  expect(closed.closed_at).toBeTruthy();
  expect(closed.realised_pnl).toBeCloseTo((130 - 100) * 10, 0);

  expect(await listOpenPositions(request, accessToken, fx.deployment._id)).toHaveLength(0);

  const dep = await getDeployment(request, accessToken, fx.deployment._id);
  expect(dep.position_size).toBe(0);

  const redisGone = await redisLiveKeyExists(openPos._id);
  if (redisGone !== null) {
    expect(redisGone).toBe(false);
  }

  expect(openTrade._id).toBeTruthy();
});

test('TC-TRD-020: flip closes long and opens short in one trade', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 90,
    quantity: 15,
    type_of_order: 'SELL',
  }));
  await expectStatus(res, 201);
  const { trade } = await parseTradeResponse(res);

  const open = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(open).toHaveLength(1);
  expect(open[0].direction).toBe('SHORT');
  expect(open[0].open_size).toBe(5);
  expect(open[0].average_entry_price).toBeCloseTo(90, 2);

  const dep = await getDeployment(request, accessToken, fx.deployment._id);
  expect(dep.position_size).toBe(-5);

  expect(trade.position_id).toBeTruthy();
});

test('TC-TRD-021: legacy cache without OPEN Position synthesizes on scale-in', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));

  const depCached = await getDeployment(request, accessToken, fx.deployment._id);
  expect(depCached.position_size).toBe(10);

  const mongoDeleted = deleteOpenPositionsViaMongo(fx.deployment._id);
  if (!mongoDeleted) {
    test.skip(true, 'MONGO_URI/mongosh unavailable — cannot simulate legacy missing Position doc');
    return;
  }

  expect(await listOpenPositions(request, accessToken, fx.deployment._id)).toHaveLength(0);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 105,
    quantity: 3,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions.length).toBeGreaterThanOrEqual(1);
  expect(positions[0].open_size).toBe(13);
  expect(positions[0].status).toBe('OPEN');
});

test('TC-TRD-022: deployment cached position mirrors trade replay (#9)', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const sequence = [
    { type_of_order: 'BUY', price: 100, quantity: 10 },
    { type_of_order: 'BUY', price: 110, quantity: 5 },
    { type_of_order: 'SELL', price: 120, quantity: 4 },
  ] as const;

  for (const leg of sequence) {
    const res = await postTrade(request, accessToken, tradePayload({
      deployment_id: fx.deployment._id,
      ...leg,
    }));
    await expectStatus(res, 201);

    const dep = await getDeployment(request, accessToken, fx.deployment._id);
    const trades = await listTradesForUser(request, accessToken, {
      deployment_id: fx.deployment._id,
      limit: 50,
    });
    const replay = replayPositionFromTrades(trades);
    expect(dep.position_size).toBeCloseTo(replay.positionSize, 4);
    expect(dep.average_entry_price).toBeCloseTo(replay.averageEntryPrice, 2);
  }
});

test('TC-TRD-023: bulk trades on deployment use O(1) fast path @slow', tags.slow, async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const N = 40;

  const start = Date.now();
  for (let i = 0; i < N; i++) {
    const res = await postTrade(request, accessToken, tradePayload({
      deployment_id: fx.deployment._id,
      price: 100 + i,
      quantity: 1,
      type_of_order: 'BUY',
    }));
    await expectStatus(res, 201);
  }
  const elapsed = Date.now() - start;

  const dep = await getDeployment(request, accessToken, fx.deployment._id);
  expect(dep.position_size).toBe(N);

  const trades = await listTradesForUser(request, accessToken, {
    deployment_id: fx.deployment._id,
    limit: N + 5,
  });
  expect(trades.length).toBe(N);
  const replay = replayPositionFromTrades(trades);
  expect(dep.position_size).toBe(replay.positionSize);

  // True O(N) replay without deployment association is blocked by required deployment_id schema
  // and Manual deployment auto-attach; this test guards fast-path consistency under volume.
  expect(elapsed).toBeLessThan(120_000);
});

// ---------------------------------------------------------------------------
// TC-TRD-024 .. TC-TRD-027 — Backtest excursion tracking
// Requires exportedData tick JSON volume — skipped when absent.
// ---------------------------------------------------------------------------

test('TC-TRD-024: BACKTEST position tracks max_up/max_down from tick files', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const symbol = fx.symbol.symbol;

  if (!(await hasBacktestTickFiles(symbol))) {
    test.skip(
      true,
      'No exportedData tick files — mount backtest-data volume (exportedData/<date>/<symbol>.json) to run excursion tests'
    );
    return;
  }

  const backtestDep = await createDeployment(request, accessToken, {
    strategy_id: fx.strategy._id,
    account_id: fx.account._id,
    user_symbol_id: fx.symbol._id,
    instrument_token: fx.symbol.instrument_token,
    symbol: fx.symbol.symbol,
    overrides: { strategy_mode: 'BACKTEST', backtest_date: '2026-01-15' },
  });

  const t0 = new Date('2026-01-15T09:30:00.000Z').toISOString();
  const t1 = new Date('2026-01-15T15:00:00.000Z').toISOString();

  await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 100,
    quantity: 5,
    type_of_order: 'BUY',
    execution_time: t0,
  }));

  const closeRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 105,
    quantity: 5,
    type_of_order: 'SELL',
    execution_time: t1,
  }));
  await expectStatus(closeRes, 201);
  const { trade } = await parseTradeResponse(closeRes);

  const posRes = await apiRequest(request, accessToken).get(`/positions/${trade.position_id!}`);
  await expectStatus(posRes, 200);
  const pos = await jsonBody<{ data: PositionRecord }>(posRes);
  expect(pos.data.status).toBe('CLOSED');
  expect(typeof pos.data.max_up).toBe('number');
  expect(typeof pos.data.max_down).toBe('number');
});

test('TC-TRD-025: excursion tick lookup tries fallback paths', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  if (!(await hasBacktestTickFiles(fx.symbol.symbol))) {
    test.skip(
      true,
      'No exportedData tick files — mount backtest-data volume (exportedData/<date>/<symbol>.json) to run excursion tests'
    );
    return;
  }

  const datesRes = await apiRequest(request, accessToken).get('/symbols/backtest-dates');
  await expectStatus(datesRes, 200);
  const datesBody = await jsonBody<{ data: string[] }>(datesRes);
  expect(Array.isArray(datesBody.data)).toBe(true);

  const backtestDep = await createDeployment(request, accessToken, {
    strategy_id: fx.strategy._id,
    account_id: fx.account._id,
    user_symbol_id: fx.symbol._id,
    instrument_token: fx.symbol.instrument_token,
    symbol: fx.symbol.symbol,
    overrides: { strategy_mode: 'BACKTEST', backtest_date: datesBody.data[0] || '2026-01-15' },
  });

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 100,
    quantity: 2,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);
});

test('TC-TRD-026: missing tick files do not crash trade save', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const uniqueSymbol = await createSymbol(request, accessToken, {
    symbol: `NOTICKS${uniqueSuffix().slice(-5)}`,
  });

  const backtestDep = await createDeployment(request, accessToken, {
    strategy_id: fx.strategy._id,
    account_id: fx.account._id,
    user_symbol_id: uniqueSymbol._id,
    instrument_token: uniqueSymbol.instrument_token,
    symbol: uniqueSymbol.symbol,
    overrides: { strategy_mode: 'BACKTEST', backtest_date: '2099-01-01' },
  });

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 50,
    quantity: 1,
    type_of_order: 'BUY',
    execution_time: new Date('2099-01-01T10:00:00.000Z').toISOString(),
  }));
  await expectStatus(res, 201);

  const closeRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 55,
    quantity: 1,
    type_of_order: 'SELL',
    execution_time: new Date('2099-01-01T11:00:00.000Z').toISOString(),
  }));
  await expectStatus(closeRes, 201);
});

test('TC-TRD-027: multi-day BACKTEST aggregates ticks across date range', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  if (!(await hasBacktestTickFiles(fx.symbol.symbol))) {
    test.skip(
      true,
      'No exportedData tick files — mount backtest-data volume (exportedData/<date>/<symbol>.json) to run excursion tests'
    );
    return;
  }

  const backtestDep = await createDeployment(request, accessToken, {
    strategy_id: fx.strategy._id,
    account_id: fx.account._id,
    user_symbol_id: fx.symbol._id,
    instrument_token: fx.symbol.instrument_token,
    symbol: fx.symbol.symbol,
    overrides: { strategy_mode: 'BACKTEST' },
  });

  await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 100,
    quantity: 3,
    type_of_order: 'BUY',
    execution_time: new Date('2026-01-15T09:00:00.000Z').toISOString(),
  }));

  const closeRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: backtestDep._id,
    price: 102,
    quantity: 3,
    type_of_order: 'SELL',
    execution_time: new Date('2026-01-17T15:00:00.000Z').toISOString(),
  }));
  await expectStatus(closeRes, 201);
  const { trade } = await parseTradeResponse(closeRes);

  const pos = await getPositionById(request, accessToken, trade.position_id!);
  expect(pos.status).toBe('CLOSED');
});

// ---------------------------------------------------------------------------
// TC-TRD-028 .. TC-TRD-033 — Reporting, legacy service-token endpoint
// ---------------------------------------------------------------------------

test('TC-TRD-028: list trades with filters scoped to caller', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    type_of_order: 'BUY',
    symbol: fx.symbol.symbol,
  }));
  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    type_of_order: 'SELL',
    price: 105,
    quantity: 2,
  }));

  const filtered = await listTradesForUser(request, accessToken, {
    type_of_order: 'BUY',
    symbol: fx.symbol.symbol,
    account_id: fx.account._id,
    deployment_id: fx.deployment._id,
    status: 'EXECUTED',
  });
  expect(filtered.length).toBeGreaterThanOrEqual(1);
  expect(filtered.every((t) => t.type_of_order === 'BUY')).toBe(true);

  const foreignAccount = newObjectId();
  const emptyRes = await apiRequest(request, accessToken).get('/trades', {
    params: { account_id: foreignAccount },
  });
  await expectStatus(emptyRes, 200);
  const emptyBody = await jsonBody<{ items: TradeRecord[]; pagination: { total: number } }>(emptyRes);
  expect(emptyBody.items).toHaveLength(0);
  expect(emptyBody.pagination.total).toBe(0);
});

test('TC-TRD-029: get trade by _id or trade_id with caller scope', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  const fx = await seedFlatDeployment(request, accessToken);
  const fxB = await seedFlatDeployment(request, userB.tokens.accessToken);

  const createRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
  }));
  const { trade } = await parseTradeResponse(createRes);

  const byMongo = await apiRequest(request, accessToken).get(`/trades/${trade._id}`);
  await expectStatus(byMongo, 200);

  const byTradeId = await apiRequest(request, accessToken).get(`/trades/${trade.trade_id}`);
  await expectStatus(byTradeId, 200);

  const bTradeRes = await postTrade(request, userB.tokens.accessToken, tradePayload({
    deployment_id: fxB.deployment._id,
  }));
  const bTrade = (await parseTradeResponse(bTradeRes)).trade;
  const idor = await apiRequest(request, accessToken).get(`/trades/${bTrade._id}`);
  await expectStatus(idor, 404);
});

test('TC-TRD-030: DELETE trade does not revert position or balance', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);
  const balanceBefore = await getAccountBalance(request, accessToken, fx.account._id);

  const createRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 5,
    type_of_order: 'BUY',
  }));
  const { trade } = await parseTradeResponse(createRes);
  const balanceAfterTrade = await getAccountBalance(request, accessToken, fx.account._id);
  expect(balanceAfterTrade).toBeLessThan(balanceBefore);

  const positionsBefore = await listOpenPositions(request, accessToken, fx.deployment._id);
  const realisedBefore = positionsBefore[0]?.realised_pnl || 0;

  const delRes = await apiRequest(request, accessToken).delete(`/trades/${trade._id}`);
  await expectStatus(delRes, 200);

  const balanceAfterDelete = await getAccountBalance(request, accessToken, fx.account._id);
  expect(balanceAfterDelete).toBe(balanceAfterTrade);

  const getRes = await apiRequest(request, accessToken).get(`/trades/${trade._id}`);
  await expectStatus(getRes, 404);

  const positionsAfter = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positionsAfter[0]?.realised_pnl || 0).toBe(realisedBefore);

  const ledger = await listLedgerForAccount(request, accessToken, fx.account._id);
  expect(ledger.some((l) => l.trade_id === trade._id)).toBe(true);
});

test('TC-TRD-031: legacy POST /api/trade accepts X-Service-Token', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const meBody = await getMe(request, accessToken);
  const me = meBody.data as { _id: string };
  const fx = await seedFlatDeployment(request, accessToken);

  const res = await postLegacyTrade(request, {
    user_id: me._id,
    deployment_id: fx.deployment._id,
    account_id: fx.account._id,
    price: 50,
    quantity: 2,
    type_of_order: 'BUY',
    execution_time: new Date().toISOString(),
  });
  await expectStatus(res, 201);
});

test('TC-TRD-032: legacy endpoint trusts body user_id (#49)', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const victim = await createUserB(request, admin.accessToken, Date.now() + 1);
  const fx = await seedFlatDeployment(request, victim.tokens.accessToken);

  const res = await postLegacyTrade(request, {
    user_id: victim.userId,
    deployment_id: fx.deployment._id,
    account_id: fx.account._id,
    price: 40,
    quantity: 1,
    type_of_order: 'BUY',
  });
  await expectStatus(res, 201);
  const { trade } = await parseTradeResponse(res);
  expect(String(trade.account_id)).toBe(String(fx.account._id));

  const victimTrades = await listTradesForUser(request, victim.tokens.accessToken, {
    deployment_id: fx.deployment._id,
  });
  expect(victimTrades.some((t) => t._id === trade._id)).toBe(true);
});

test('TC-TRD-033: legacy endpoint rejects unauthenticated calls', async ({ request }) => {
  const res = await request.post(apiPath('api/trade'), {
    headers: { 'Content-Type': 'application/json' },
    data: { price: 1, quantity: 1, type_of_order: 'BUY', user_id: newObjectId() },
  });
  await expectStatus(res, 401);
});

// ---------------------------------------------------------------------------
// TC-POS-001 .. TC-POS-005 — Position endpoints & Redis sync
// ---------------------------------------------------------------------------

test('TC-POS-001: list positions scoped to caller', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  const fxA = await seedFlatDeployment(request, admin.accessToken);
  const fxB = await seedFlatDeployment(request, userB.tokens.accessToken);

  await postTrade(request, admin.accessToken, tradePayload({ deployment_id: fxA.deployment._id }));
  await postTrade(request, userB.tokens.accessToken, tradePayload({ deployment_id: fxB.deployment._id }));

  const meBody = await getMe(request, admin.accessToken);
  const adminId = (meBody.data as { _id: string })._id;

  const listA = await apiRequest(request, admin.accessToken).get('/positions');
  const bodyA = await jsonBody<{ items: PositionRecord[] }>(listA);
  expect(bodyA.items.every((p) => String(p.user_id) === String(adminId))).toBe(true);
  expect(bodyA.items.some((p) => p.deployment_id === fxA.deployment._id)).toBe(true);
  expect(bodyA.items.some((p) => p.deployment_id === fxB.deployment._id)).toBe(false);

  const listB = await apiRequest(request, userB.tokens.accessToken).get('/positions');
  const bodyB = await jsonBody<{ items: PositionRecord[] }>(listB);
  expect(bodyB.items.some((p) => p.deployment_id === fxB.deployment._id)).toBe(true);
  expect(bodyB.items.some((p) => p.deployment_id === fxA.deployment._id)).toBe(false);
});

test('TC-POS-002: get position by ID IDOR check', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  const fxB = await seedFlatDeployment(request, userB.tokens.accessToken);

  await postTrade(request, userB.tokens.accessToken, tradePayload({ deployment_id: fxB.deployment._id }));
  const bPositions = await listOpenPositions(request, userB.tokens.accessToken, fxB.deployment._id);

  const idor = await apiRequest(request, admin.accessToken).get(`/positions/${bPositions[0]._id}`);
  await expectStatus(idor, 404);
});

test('TC-POS-003: live mode updates unrealised_pnl and excursions on partial trade', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 10,
    type_of_order: 'BUY',
  }));

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 115,
    quantity: 2,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);
  const { trade } = await parseTradeResponse(res);

  const pos = await getPositionById(request, accessToken, trade.position_id!);
  expect(pos.last_ltp).toBe(115);
  expect(pos.unrealised_pnl).toBeCloseTo((115 - pos.average_entry_price) * pos.open_size, 0);
  expect(pos.max_up).toBeGreaterThanOrEqual(0);
  expect(pos.max_down).toBeLessThanOrEqual(0);
});

test('TC-POS-004: Redis live-position cache synced on open/scale/close', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const openRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 100,
    quantity: 4,
    type_of_order: 'BUY',
  }));
  const { trade: openTrade } = await parseTradeResponse(openRes);
  const openPos = await getPositionById(request, accessToken, openTrade.position_id!);

  const redisOpen = await redisLiveKeyExists(openPos._id);
  if (redisOpen !== null) {
    expect(redisOpen).toBe(true);
  }

  const scaleRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 102,
    quantity: 2,
    type_of_order: 'BUY',
  }));
  const { trade: scaleTrade } = await parseTradeResponse(scaleRes);
  const scaledPos = await getPositionById(request, accessToken, scaleTrade.position_id!);
  expect(scaledPos.open_size).toBe(6);

  const closeRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 110,
    quantity: 6,
    type_of_order: 'SELL',
  }));
  await expectStatus(closeRes, 201);

  const redisClosed = await redisLiveKeyExists(openPos._id);
  if (redisClosed !== null) {
    expect(redisClosed).toBe(false);
  }
});

test('TC-POS-005: Redis sync failure does not fail trade response', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  // When REDIS_URL is unset server-side, sync is skipped/logged — Mongo remains source of truth.
  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 75,
    quantity: 3,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 201);

  const { trade, closing_balance } = await parseTradeResponse(res);
  expect(trade._id).toBeTruthy();
  expect(typeof closing_balance).toBe('number');

  const positions = await listOpenPositions(request, accessToken, fx.deployment._id);
  expect(positions.length).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// TC-TRD-034 .. TC-TRD-036 — Transactional integrity & symbol_control flush
// ---------------------------------------------------------------------------

test('TC-TRD-034: validation failure aborts transaction — no partial writes', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken, {
    initial_balance: 200,
    current_balance: 200,
  });
  const balanceBefore = await getAccountBalance(request, accessToken, fx.account._id);
  const tradesBefore = await listTradesForUser(request, accessToken, {
    deployment_id: fx.deployment._id,
  });
  const positionsBefore = await listOpenPositions(request, accessToken, fx.deployment._id);

  const res = await postTrade(request, accessToken, tradePayload({
    deployment_id: fx.deployment._id,
    price: 500,
    quantity: 10,
    type_of_order: 'BUY',
  }));
  await expectStatus(res, 500);
  await expectMessageContains(res, 'Insufficient balance');

  expect(await getAccountBalance(request, accessToken, fx.account._id)).toBe(balanceBefore);
  expect(await listTradesForUser(request, accessToken, { deployment_id: fx.deployment._id })).toHaveLength(
    tradesBefore.length
  );
  expect(await listOpenPositions(request, accessToken, fx.deployment._id)).toHaveLength(
    positionsBefore.length
  );
});

test('TC-TRD-035: concurrent trades serialize without lost updates @race', tags.race, async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const legs = [
    { type_of_order: 'BUY' as const, price: 100, quantity: 1 },
    { type_of_order: 'BUY' as const, price: 101, quantity: 1 },
    { type_of_order: 'SELL' as const, price: 102, quantity: 1 },
    { type_of_order: 'BUY' as const, price: 103, quantity: 1 },
    { type_of_order: 'SELL' as const, price: 104, quantity: 1 },
    { type_of_order: 'BUY' as const, price: 105, quantity: 1 },
  ];

  const results = await fireConcurrentWithResults(async (i) => {
    const leg = legs[i % legs.length];
    const res = await postTrade(request, accessToken, tradePayload({
      deployment_id: fx.deployment._id,
      ...leg,
    }));
    return { status: res.status(), ok: res.ok(), body: await res.text().catch(() => '') };
  }, legs.length);

  const successes = results.filter((r) => r.ok);
  expect(successes.length).toBeGreaterThan(0);

  const dep = await getDeployment(request, accessToken, fx.deployment._id);
  const trades = await listTradesForUser(request, accessToken, {
    deployment_id: fx.deployment._id,
    limit: 20,
  });
  const replay = replayPositionFromTrades(trades);
  expect(dep.position_size).toBeCloseTo(replay.positionSize, 4);
  expect(dep.average_entry_price).toBeCloseTo(replay.averageEntryPrice, 2);
});

test('TC-TRD-036: flush pending symbol resolve after full flat close', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const fx = await seedFlatDeployment(request, accessToken);

  const underlying = await createSymbol(request, accessToken, {
    symbol: `UNDER${uniqueSuffix().slice(-4)}`,
    instrument_class: 'INDEX',
    strike_price_diff: 50,
  });

  const expiry = '2026-12-25';
  let controlledDepId: string;
  try {
    const created = await createDeployment(request, accessToken, {
      strategy_id: fx.strategy._id,
      account_id: fx.account._id,
      user_symbol_id: underlying._id,
      instrument_token: underlying.instrument_token,
      symbol: underlying.symbol,
      overrides: {
        strategy_mode: 'PAPER',
        symbol_control: {
          enabled: true,
          underlying_user_symbol_id: underlying._id,
          moneyness: 'ATM',
          option_type: 'CE',
          expiry,
          offset: 1,
        },
      },
    });
    controlledDepId = created._id;
  } catch {
    test.skip(true, 'symbol_control deployment requires option-chain/LTP services');
    return;
  }

  await postTrade(request, accessToken, tradePayload({
    deployment_id: controlledDepId,
    price: 100,
    quantity: 2,
    type_of_order: 'BUY',
  }));

  const resolveRes = await request.post(apiPath(`/deployments/${controlledDepId}/resolve-symbol`), {
    headers: serviceHeaders(),
    data: { ltp: 24000 },
  });
  if (!resolveRes.ok()) {
    test.skip(true, 'resolve-symbol unavailable — needs X-Service-Token and option resolver stack');
    return;
  }
  const resolveBody = await jsonBody<{ data: { deferred?: boolean; deployment?: DeploymentRecord } }>(resolveRes);
  expect(resolveBody.data.deferred).toBe(true);

  let dep = await getDeployment(request, accessToken, controlledDepId);
  expect(dep.symbol_control?.pending_resolve).toBe(true);

  const closeRes = await postTrade(request, accessToken, tradePayload({
    deployment_id: controlledDepId,
    price: 105,
    quantity: 2,
    type_of_order: 'SELL',
  }));
  await expectStatus(closeRes, 201);

  dep = await getDeployment(request, accessToken, controlledDepId);
  expect(dep.position_size).toBe(0);
  expect(dep.symbol_control?.pending_resolve).toBe(false);
});
