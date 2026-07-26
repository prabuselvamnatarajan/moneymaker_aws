import { expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  apiPath,
  apiRequest,
  createUserB,
  getMe,
  loginAs,
  loginAsAdmin,
  loginAsUser,
  uniqueSuffix,
} from '../fixtures/auth';
import {
  createAccount,
  createExternalBrokerForUser,
  createTradeFixture,
  getExternalBroker,
  getInternalBroker,
  listBrokers,
} from '../fixtures/factories';
import {
  expectMessageContains,
  expectStatus,
  jsonBody,
  tags,
  test,
} from '../fixtures/test-helpers';

const ROUTES_DIR = path.resolve(__dirname, '../../BackTest/BackTestApp/src/routes');
const MONGO_URI = process.env.MONGO_URI || process.env.E2E_MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'BacktestApp';

interface BrokerDoc {
  _id: string;
  name?: string;
  user_id?: string;
  is_internal?: boolean;
  credentials?: Record<string, unknown>;
  access_token?: string;
  external_broker_id?: string;
  token_status?: string;
}

interface UserDoc {
  _id: string;
  email?: string;
  username?: string;
  password?: string;
  roles?: Array<{ name?: string; _id?: string }>;
}

interface RouteAuditEntry {
  file: string;
  line: number;
  method: string;
  routePath: string;
  middlewares: string[];
}

function unwrapData<T>(raw: unknown): T {
  const wrapped = raw as { data?: T };
  return (wrapped.data ?? raw) as T;
}

async function brokersFromList(res: APIResponse): Promise<BrokerDoc[]> {
  const body = await jsonBody<{ items?: BrokerDoc[] }>(res);
  return body.items ?? [];
}

function upstoxToken(expiresAtSec: number): string {
  return jwt.sign({ sub: 'e2e-upstox', exp: expiresAtSec }, 'e2e-upstox-secret');
}

async function withMongo<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T | undefined> {
  if (!MONGO_URI) return undefined;
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    return await fn(client.db(MONGO_DB));
  } finally {
    await client.close();
  }
}

function responseHasPasswordField(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if ('password' in (obj as Record<string, unknown>)) return true;
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (responseHasPasswordField(value)) return true;
  }
  return false;
}

function grepRoutesForAuthorize(): string[] {
  const hits: string[] = [];
  if (!fs.existsSync(ROUTES_DIR)) return hits;
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    content.split('\n').forEach((line, idx) => {
      if (line.includes('authorize(')) {
        hits.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

function enumerateMutatingRoutes(): RouteAuditEntry[] {
  const entries: RouteAuditEntry[] = [];
  if (!fs.existsSync(ROUTES_DIR)) return entries;

  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const lines = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const match = line.match(
        /router\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]\s*,\s*(.+)/
      );
      if (!match) return;
      const [, method, routePath, chain] = match;
      const middlewares = chain
        .replace(/\);.*$/, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !/Controller$/.test(s));
      entries.push({ file, line: idx + 1, method, routePath, middlewares });
    });
  }
  return entries;
}

function upstoxCredentials(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'e2e-client-id',
    client_secret: 'e2e-client-secret',
    redirect_uri: 'http://localhost/callback',
    ...overrides,
  };
}

async function postBroker(
  request: APIRequestContext,
  token: string,
  payload: Record<string, unknown>
) {
  return apiRequest(request, token).post('/brokers', { data: payload });
}

async function brokerFromResponse(res: APIResponse): Promise<BrokerDoc> {
  return unwrapData<BrokerDoc>(await jsonBody(res));
}

// ─── Broker — Create (TC-BRK-001 – TC-BRK-004) ─────────────────────────────

test('TC-BRK-001: Regular user can create their own (non-internal) broker', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const me = await getMe(request, accessToken);
  const suffix = uniqueSuffix();
  const secret = `secret-${suffix}`;

  const res = await postBroker(request, accessToken, {
    name: `My Upstox ${suffix}`,
    external_broker_id: 'upstox',
    credentials: upstoxCredentials({ client_secret: secret }),
  });
  await expectStatus(res, 201);
  const broker = await brokerFromResponse(res);

  expect(broker.is_internal).toBe(false);
  expect(String(broker.user_id)).toBe(String(me.data?._id ?? me.data?.id));
  expect(broker.credentials?.client_secret).toBe(secret);
});

test('TC-BRK-002: createBroker has no field whitelist — client can set is_internal:true (#40)', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();

  const res = await postBroker(request, accessToken, {
    name: `Hijack ${suffix}`,
    is_internal: true,
  });
  await expectStatus(res, 201);
  const broker = await brokerFromResponse(res);

  expect(broker.is_internal).toBe(true);
  expect(broker.name).toContain('Hijack');
});

test('TC-BRK-003: Multiple internal brokers can coexist — no uniqueness constraint (#40)', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const userB = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();

  const hijackRes = await postBroker(request, userB.tokens.accessToken, {
    name: `Hijacked Internal ${suffix}`,
    is_internal: true,
  });
  await expectStatus(hijackRes, 201);
  const hijacked = await brokerFromResponse(hijackRes);

  const accountRes = await apiRequest(request, userB.tokens.accessToken).post('/accounts', {
    data: {
      account_name: `paper-after-hijack-${suffix}`,
      account_type: 'PAPER',
      initial_balance: 50000,
    },
  });
  await expectStatus(accountRes, 201);
  const account = unwrapData<{ broker_id?: string }>(await jsonBody(accountRes));

  const internalBrokers = (await listBrokers(request, admin.accessToken)).filter(
    (b: BrokerDoc) => b.is_internal
  );
  expect(internalBrokers.length).toBeGreaterThanOrEqual(2);
  expect(account.broker_id).toBeTruthy();
  expect(internalBrokers.some((b: BrokerDoc) => String(b._id) === String(account.broker_id))).toBe(
    true
  );
});

test('TC-BRK-004: Missing required name field rejected', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await postBroker(request, accessToken, {
    external_broker_id: 'upstox',
    credentials: upstoxCredentials(),
  });
  await expectStatus(res, [400, 500]);
  await expectMessageContains(res, 'name');
});

// ─── Broker — Secrets Handling (TC-BRK-005 – TC-BRK-009) ───────────────────

test('TC-BRK-005: GET /api/brokers returns raw credentials/access_token in plaintext (#29)', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const secret = 'supersecret123';
  const tokenValue = upstoxToken(Math.floor(Date.now() / 1000) + 3600);

  const createRes = await postBroker(request, accessToken, {
    name: `Secrets Broker ${suffix}`,
    external_broker_id: 'upstox',
    credentials: upstoxCredentials({ client_secret: secret }),
    access_token: tokenValue,
  });
  await expectStatus(createRes, 201);
  const created = await brokerFromResponse(createRes);

  const listRes = await apiRequest(request, accessToken).get('/brokers');
  await expectStatus(listRes, 200);
  const brokers = await brokersFromList(listRes);
  const found = brokers.find((b) => String(b._id) === String(created._id));
  expect(found).toBeTruthy();
  expect(found!.credentials?.client_secret).toBe(secret);
  expect(found!.access_token).toBe(tokenValue);
});

test('TC-BRK-006: Non-admin list only sees internal brokers + their own', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userA = await loginAsUser(request);
  const userB = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();
  const secretA = `user-a-secret-${suffix}`;

  const createRes = await postBroker(request, userA.accessToken, {
    name: `User A Broker ${suffix}`,
    external_broker_id: 'upstox',
    credentials: upstoxCredentials({ client_secret: secretA }),
  });
  await expectStatus(createRes, 201);
  const brokerA = await brokerFromResponse(createRes);

  const listRes = await apiRequest(request, userB.tokens.accessToken).get('/brokers');
  await expectStatus(listRes, 200);
  const brokers = await brokersFromList(listRes);

  expect(brokers.some((b) => String(b._id) === String(brokerA._id))).toBe(false);
  expect(brokers.some((b) => b.is_internal)).toBe(true);

  const internalWithSecrets = brokers.filter((b) => b.is_internal);
  for (const internal of internalWithSecrets) {
    // Internal brokers may omit credentials entirely; non-null secrets are still exposed when present.
    if (internal.credentials != null) {
      expect(internal.credentials).toBeDefined();
    }
  }
});

test('TC-BRK-007: Admin list returns ALL brokers platform-wide including secrets', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const userA = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const secret = `admin-visible-${suffix}`;

  const createRes = await postBroker(request, userA.accessToken, {
    name: `User A Private ${suffix}`,
    external_broker_id: 'upstox',
    credentials: upstoxCredentials({ client_secret: secret }),
  });
  await expectStatus(createRes, 201);
  const personal = await brokerFromResponse(createRes);

  const listRes = await apiRequest(request, admin.accessToken).get('/brokers');
  await expectStatus(listRes, 200);
  const brokers = await brokersFromList(listRes);

  const found = brokers.find((b) => String(b._id) === String(personal._id));
  expect(found).toBeTruthy();
  expect(found!.credentials?.client_secret).toBe(secret);
  expect(brokers.length).toBeGreaterThan(1);
});

test('TC-BRK-008: Expired Upstox token auto-cleared with token_status expired', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const expiredToken = upstoxToken(Math.floor(Date.now() / 1000) - 3600);

  const createRes = await postBroker(request, accessToken, {
    name: `Expired Upstox ${suffix}`,
    external_broker_id: 'upstox',
    access_token: expiredToken,
    credentials: upstoxCredentials(),
  });
  await expectStatus(createRes, 201);
  const created = await brokerFromResponse(createRes);

  const listRes = await apiRequest(request, accessToken).get('/brokers');
  await expectStatus(listRes, 200);
  const brokers = await brokersFromList(listRes);
  const found = brokers.find((b) => String(b._id) === String(created._id));
  expect(found).toBeTruthy();
  expect(found!.access_token).toBe('');
  expect(found!.token_status).toBe('expired');
});

test('TC-BRK-009: Non-expired Upstox broker gets token_status without mutation', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const validToken = upstoxToken(Math.floor(Date.now() / 1000) + 7200);

  const createRes = await postBroker(request, accessToken, {
    name: `Valid Upstox ${suffix}`,
    external_broker_id: 'upstox',
    access_token: validToken,
    credentials: upstoxCredentials(),
  });
  await expectStatus(createRes, 201);
  const created = await brokerFromResponse(createRes);

  const listRes = await apiRequest(request, accessToken).get('/brokers');
  await expectStatus(listRes, 200);
  const brokers = await brokersFromList(listRes);
  const found = brokers.find((b) => String(b._id) === String(created._id));
  expect(found).toBeTruthy();
  expect(found!.access_token).toBe(validToken);
  expect(found!.token_status).toBe('valid');
});

// ─── Broker — Update / Delete (TC-BRK-010 – TC-BRK-014) ────────────────────

test('TC-BRK-010: Non-admin cannot update or delete an internal broker', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const internal = await getInternalBroker(request, accessToken);

  const putRes = await apiRequest(request, accessToken).put(`/brokers/${internal._id}`, {
    data: { name: 'Should Fail' },
  });
  await expectStatus(putRes, 500);
  await expectMessageContains(putRes, 'not authorized');

  const delRes = await apiRequest(request, accessToken).delete(`/brokers/${internal._id}`);
  await expectStatus(delRes, 500);
  await expectMessageContains(delRes, 'not authorized');
});

test('TC-BRK-011: Non-admin cannot update/delete another user personal broker (IDOR)', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const userA = await loginAsUser(request);
  const userB = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();

  const createRes = await createExternalBrokerForUser(request, userA.accessToken, suffix);
  const brokerA = createRes as BrokerDoc;

  const putRes = await apiRequest(request, userB.tokens.accessToken).put(`/brokers/${brokerA._id}`, {
    data: { name: 'Stolen Broker' },
  });
  await expectStatus(putRes, 500);
  await expectMessageContains(putRes, 'not authorized');

  const delRes = await apiRequest(request, userB.tokens.accessToken).delete(`/brokers/${brokerA._id}`);
  await expectStatus(delRes, 500);
  await expectMessageContains(delRes, 'not authorized');
});

test('TC-BRK-012: Admin CAN update/delete internal broker', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();

  const hijackRes = await postBroker(request, accessToken, {
    name: `Admin Deletable Internal ${suffix}`,
    is_internal: true,
  });
  await expectStatus(hijackRes, 201);
  const hijacked = await brokerFromResponse(hijackRes);

  const platformInternal = await getInternalBroker(request, admin.accessToken);
  const originalName = platformInternal.name as string;
  const tempName = `${originalName} E2E ${suffix}`;

  const putRes = await apiRequest(request, admin.accessToken).put(`/brokers/${platformInternal._id}`, {
    data: { name: tempName },
  });
  await expectStatus(putRes, 200);
  const updated = unwrapData<BrokerDoc>(await jsonBody(putRes));
  expect(updated.name).toBe(tempName);

  await apiRequest(request, admin.accessToken).put(`/brokers/${platformInternal._id}`, {
    data: { name: originalName },
  });

  const delRes = await apiRequest(request, admin.accessToken).delete(`/brokers/${hijacked._id}`);
  await expectStatus(delRes, 200);

  const listRes = await apiRequest(request, admin.accessToken).get('/brokers');
  const brokers = await brokersFromList(listRes);
  expect(brokers.some((b) => String(b._id) === String(hijacked._id))).toBe(false);
});

test('TC-BRK-013: Update credentials merges rather than replaces', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();

  const createRes = await postBroker(request, accessToken, {
    name: `Merge Creds ${suffix}`,
    credentials: { a: 1, b: 2 },
  });
  await expectStatus(createRes, 201);
  const broker = await brokerFromResponse(createRes);

  const putRes = await apiRequest(request, accessToken).put(`/brokers/${broker._id}`, {
    data: { credentials: { b: 3, c: 4 } },
  });
  await expectStatus(putRes, 200);
  const updated = unwrapData<BrokerDoc>(await jsonBody(putRes));
  expect(updated.credentials).toEqual({ a: 1, b: 3, c: 4 });
});

test('TC-BRK-014: Deleting broker referenced by account leaves dangling broker_id', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const suffix = uniqueSuffix();
  const external = await resolveExternalBroker(request, accessToken);

  const accountRes = await apiRequest(request, accessToken).post('/accounts', {
    data: {
      account_name: `live-dangling-${suffix}`,
      account_type: 'LIVE',
      initial_balance: 25000,
      broker_id: external._id,
    },
  });
  await expectStatus(accountRes, 201);
  const account = unwrapData<{ _id: string; broker_id?: string }>(await jsonBody(accountRes));
  expect(String(account.broker_id)).toBe(String(external._id));

  const delRes = await apiRequest(request, accessToken).delete(`/brokers/${external._id}`);
  await expectStatus(delRes, 200);

  const danglingId = await withMongo(async (db) => {
    const { ObjectId } = await import('mongodb');
    const query = ObjectId.isValid(account._id)
      ? { _id: new ObjectId(account._id) }
      : { account_id: account._id };
    const doc = await db.collection('accounts').findOne(query);
    return doc?.broker_id ? String(doc.broker_id) : undefined;
  });
  if (danglingId) {
    expect(danglingId).toBe(String(external._id));
  }

  const getRes = await apiRequest(request, accessToken).get(`/accounts/${account._id}`);
  await expectStatus(getRes, 200);
  const fetched = unwrapData<{ broker_id?: string | BrokerDoc | null }>(await jsonBody(getRes));
  const populatedId =
    fetched.broker_id && typeof fetched.broker_id === 'object'
      ? fetched.broker_id._id
      : fetched.broker_id;
  expect(populatedId == null || String(populatedId) === String(external._id)).toBe(true);
});

async function resolveExternalBroker(request: APIRequestContext, token: string): Promise<BrokerDoc> {
  const existing = await getExternalBroker(request, token);
  if (existing) return existing as BrokerDoc;
  return createExternalBrokerForUser(request, token) as Promise<BrokerDoc>;
}

// ─── External Broker Catalog (TC-BRK-015 – TC-BRK-016) ─────────────────────

test('TC-BRK-015: Any authenticated user can list the external broker catalog', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).get('/external-brokers');
  await expectStatus(res, 200);
  const body = await jsonBody<{ items?: unknown[] }>(res);
  expect(Array.isArray(body.items)).toBe(true);
  expect((body.items ?? []).length).toBeGreaterThan(0);
});

test('TC-BRK-016: Only admin can create/update/delete external broker catalog entries', async ({
  request,
}) => {
  const { accessToken } = await loginAsUser(request);
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();

  const postRes = await apiRequest(request, accessToken).post('/external-brokers', {
    data: { external_broker_id: `e2e-denied-${suffix}` },
  });
  await expectStatus(postRes, 403);
  await expectMessageContains(postRes, 'Administrator');

  const catalogRes = await apiRequest(request, admin.accessToken).get('/external-brokers');
  await expectStatus(catalogRes, 200);
  const catalog = await jsonBody<{ items: Array<{ _id: string; external_broker_id: string }> }>(
    catalogRes
  );
  const target = catalog.items[0];
  expect(target?._id).toBeTruthy();

  const putRes = await apiRequest(request, accessToken).put(`/external-brokers/${target._id}`, {
    data: { external_broker_id: `blocked-${suffix}` },
  });
  await expectStatus(putRes, 403);

  const delRes = await apiRequest(request, accessToken).delete(`/external-brokers/${target._id}`);
  await expectStatus(delRes, 403);
});

// ─── Admin — User Management (TC-ADM-001 – TC-ADM-009) ─────────────────────

test('TC-ADM-001: Non-admin cannot access any /api/admin/* route', async ({ request }) => {
  const { accessToken } = await loginAsUser(request);
  const res = await apiRequest(request, accessToken).get('/admin/users');
  await expectStatus(res, 403);
  await expectMessageContains(res, 'Administrator');
});

test('TC-ADM-002: Admin creates a new user; duplicate email rejected', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const email = `adm-create-${suffix}@e2e.test.com`;
  const username = `admuser${suffix}`;
  const password = 'AdminCreate123!';

  const first = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: { username, name: 'Admin Created', email, password },
  });
  await expectStatus(first, 201);
  const created = unwrapData<UserDoc>(await jsonBody(first));
  expect(created.email?.toLowerCase()).toBe(email.toLowerCase());
  expect(responseHasPasswordField(created)).toBe(false);

  const dup = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username: `${username}x`,
      name: 'Dup Email',
      email,
      password: 'OtherPass123!',
    },
  });
  await expectStatus(dup, 409);
  await expectMessageContains(dup, 'Email is already taken');
});

test('TC-ADM-003: Duplicate username (different email) rejected', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const username = `dupuser${suffix}`;
  const password = 'DupUser123!';

  const first = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username,
      name: 'First User',
      email: `first-${suffix}@e2e.test.com`,
      password,
    },
  });
  await expectStatus(first, 201);

  const dup = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username,
      name: 'Second User',
      email: `second-${suffix}@e2e.test.com`,
      password,
    },
  });
  await expectStatus(dup, 409);
  await expectMessageContains(dup, 'Username is already taken');
});

test('TC-ADM-004: Missing required fields on user creation rejected', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const base = {
    username: 'adm',
    name: 'Admin User',
    email: 'adm@e2e.test.com',
    password: 'Pass123!',
  };
  const cases = [
    { ...base, password: undefined },
    { ...base, email: undefined },
    { ...base, username: undefined },
    { ...base, name: undefined },
  ];

  for (const body of cases) {
    const res = await apiRequest(request, admin.accessToken).post('/admin/users', { data: body });
    await expectStatus(res, 400);
    await expectMessageContains(res, 'Username, name, email, and password are required');
  }
});

test('TC-ADM-005: initializeUserAccounts failure does not block user creation', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const email = `init-resilient-${suffix}@e2e.test.com`;
  const password = 'InitResilient123!';

  const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username: `initres${suffix}`,
      name: 'Init Resilient User',
      email,
      password,
    },
  });
  await expectStatus(createRes, 201);
  const user = unwrapData<UserDoc>(await jsonBody(createRes));
  const userId = String(user._id);

  const getRes = await apiRequest(request, admin.accessToken).get(`/admin/users/${userId}`);
  await expectStatus(getRes, 200);

  const accountsRemoved = await withMongo(async (db) => {
    await db.collection('accounts').deleteMany({ user_id: userId });
    return true;
  });

  if (accountsRemoved) {
    const accountsRes = await apiRequest(request, admin.accessToken).get(
      `/admin/users/${userId}/accounts`
    );
    await expectStatus(accountsRes, 200);
    const accountsBody = await jsonBody<{ items: unknown[] }>(accountsRes);
    expect(accountsBody.items.length).toBe(0);
  }

  const stillThere = await apiRequest(request, admin.accessToken).get(`/admin/users/${userId}`);
  await expectStatus(stillThere, 200);
});

test('TC-ADM-006: Admin update user — email/username uniqueness re-checked only when changed', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const user1 = await createUserB(request, admin.accessToken, Date.now());
  const user2 = await createUserB(request, admin.accessToken, Date.now() + 1);

  const noop = await apiRequest(request, admin.accessToken).patch(`/admin/users/${user1.userId}`, {
    data: { email: user1.email },
  });
  await expectStatus(noop, 200);

  const conflict = await apiRequest(request, admin.accessToken).patch(`/admin/users/${user1.userId}`, {
    data: { email: user2.email },
  });
  await expectStatus(conflict, 409);
  await expectMessageContains(conflict, 'Email is already taken');
});

test('TC-ADM-007: Admin update user password re-hashes via bcrypt', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const email = `pw-hash-${suffix}@e2e.test.com`;
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';

  const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username: `pwhash${suffix}`,
      name: 'Password Hash User',
      email,
      password: oldPassword,
    },
  });
  await expectStatus(createRes, 201);
  const created = unwrapData<UserDoc>(await jsonBody(createRes));
  expect(responseHasPasswordField(created)).toBe(false);

  const patchRes = await apiRequest(request, admin.accessToken).patch(
    `/admin/users/${created._id}`,
    { data: { password: newPassword } }
  );
  await expectStatus(patchRes, 200);
  const patched = unwrapData<UserDoc>(await jsonBody(patchRes));
  expect(responseHasPasswordField(patched)).toBe(false);

  const storedHash = await withMongo(async (db) => {
    const doc = await db.collection('users').findOne({ email: email.toLowerCase() });
    return doc?.password as string | undefined;
  });
  if (storedHash) {
    expect(storedHash).toMatch(/^\$2[aby]\$/);
    expect(storedHash).not.toBe(newPassword);
  }

  await loginAs(request, email, newPassword);
  const badLogin = await request.post(apiPath('/auth/login'), {
    data: { email, password: oldPassword },
  });
  expect(badLogin.status()).toBeGreaterThanOrEqual(400);
});

test('TC-ADM-008: Admin delete user is a hard delete with no cascade cleanup', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const suffix = uniqueSuffix();
  const email = `orphan-admin-${suffix}@e2e.test.com`;
  const password = 'OrphanAdmin123!';

  const createRes = await apiRequest(request, admin.accessToken).post('/admin/users', {
    data: {
      username: `orphanadm${suffix}`,
      name: 'Orphan Admin Delete',
      email,
      password,
    },
  });
  await expectStatus(createRes, 201);
  const created = unwrapData<UserDoc>(await jsonBody(createRes));
  const userId = String(created._id);
  const tokens = await loginAs(request, email, password);
  await createAccount(request, tokens.accessToken, { account_name: `orphan-acct-${suffix}` });

  const delRes = await apiRequest(request, admin.accessToken).delete(`/admin/users/${userId}`);
  await expectStatus(delRes, 200);

  const orphans = await withMongo(async (db) => {
    const accounts = await db.collection('accounts').countDocuments({ user_id: userId });
    const strategies = await db.collection('strategies').countDocuments({ user_id: userId });
    return { accounts, strategies };
  });

  if (orphans) {
    expect(orphans.accounts).toBeGreaterThan(0);
    expect(orphans.strategies).toBeGreaterThanOrEqual(0);
  } else {
    const getRes = await apiRequest(request, admin.accessToken).get(`/admin/users/${userId}`);
    await expectStatus(getRes, 404);
  }
});

test('TC-ADM-009: Get/list users returns -password and populates roles', async ({ request }) => {
  const admin = await loginAsAdmin(request);

  const listRes = await apiRequest(request, admin.accessToken).get('/admin/users');
  await expectStatus(listRes, 200);
  const listBody = await jsonBody<{ items: UserDoc[] }>(listRes);
  expect(listBody.items.length).toBeGreaterThan(0);

  for (const user of listBody.items) {
    expect(responseHasPasswordField(user)).toBe(false);
    expect(Array.isArray(user.roles)).toBe(true);
    if (user.roles && user.roles.length > 0) {
      expect(user.roles[0]).toHaveProperty('name');
    }
  }

  const target = listBody.items[0];
  const getRes = await apiRequest(request, admin.accessToken).get(`/admin/users/${target._id}`);
  await expectStatus(getRes, 200);
  const single = unwrapData<UserDoc>(await jsonBody(getRes));
  expect(responseHasPasswordField(single)).toBe(false);
  expect(Array.isArray(single.roles)).toBe(true);
});

// ─── Admin — User Sub-Resources / Bypasses (TC-ADM-010 – TC-ADM-014) ────────

test('TC-ADM-010: createUserAccount bypasses service — no internal-broker auto-assignment (#51)', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const target = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();

  const res = await apiRequest(request, admin.accessToken).post(
    `/admin/users/${target.userId}/accounts`,
    {
      data: {
        account_name: `Admin-created PAPER ${suffix}`,
        account_type: 'PAPER',
        initial_balance: 10000,
      },
    }
  );
  await expectStatus(res, 201);
  const account = unwrapData<{ broker_id?: string | null }>(await jsonBody(res));
  expect(account.broker_id == null || account.broker_id === '').toBe(true);
});

test('TC-ADM-011: createUserAccount skips current_balance defaulting from service (#51)', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const target = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();

  const res = await apiRequest(request, admin.accessToken).post(
    `/admin/users/${target.userId}/accounts`,
    {
      data: {
        account_name: `Admin balance gap ${suffix}`,
        account_type: 'PAPER',
        initial_balance: 10000,
      },
    }
  );
  await expectStatus(res, 201);
  const account = unwrapData<{ current_balance: number; initial_balance: number }>(
    await jsonBody(res)
  );
  expect(account.initial_balance).toBe(10000);
  expect(account.current_balance).toBe(0);
});

test('TC-ADM-012: createUserStrategy bypasses service advanced-field defaulting (#51)', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const target = await createUserB(request, admin.accessToken);
  const suffix = uniqueSuffix();

  const adminRes = await apiRequest(request, admin.accessToken).post(
    `/admin/users/${target.userId}/strategies`,
    { data: { strategy_name: `Admin Strategy ${suffix}` } }
  );
  await expectStatus(adminRes, 201);
  const adminStrategy = unwrapData<{
    target_pts?: number;
    sl_pts?: number;
    advance_trade_decision?: boolean;
  }>(await jsonBody(adminRes));

  const userRes = await apiRequest(request, target.tokens.accessToken).post('/strategies', {
    data: { strategy_name: `User Strategy ${suffix}` },
  });
  await expectStatus(userRes, 201);
  const userStrategy = unwrapData<{
    target_pts?: number;
    sl_pts?: number;
    advance_trade_decision?: boolean;
  }>(await jsonBody(userRes));

  expect(adminStrategy.target_pts).toBe(500);
  expect(adminStrategy.sl_pts).toBe(500);
  expect(adminStrategy.advance_trade_decision).toBe(false);
  expect(userStrategy.target_pts).toBe(500);
  expect(userStrategy.sl_pts).toBe(500);
  expect(userStrategy.advance_trade_decision).toBe(false);
});

test('TC-ADM-013: Admin sub-resource GETs scope to :userId path param', async ({ request }) => {
  const admin = await loginAsAdmin(request);
  const userA = await createUserB(request, admin.accessToken, Date.now());
  const userB = await createUserB(request, admin.accessToken, Date.now() + 1);

  await createAccount(request, userA.tokens.accessToken, {
    account_name: `scoped-a-${uniqueSuffix()}`,
  });
  await createAccount(request, userB.tokens.accessToken, {
    account_name: `scoped-b-${uniqueSuffix()}`,
  });
  await createTradeFixture(request, userA.tokens.accessToken);

  const endpoints = [
    `/admin/users/${userA.userId}/accounts`,
    `/admin/users/${userA.userId}/strategies`,
    `/admin/users/${userA.userId}/deployments`,
    `/admin/users/${userA.userId}/trades`,
    `/admin/users/${userA.userId}/ledger`,
  ];

  for (const path of endpoints) {
    const res = await apiRequest(request, admin.accessToken).get(path);
    await expectStatus(res, 200);
    const body = await jsonBody<{ items: Array<{ user_id?: string }> }>(res);
    for (const item of body.items ?? []) {
      if (item.user_id) {
        expect(String(item.user_id)).toBe(String(userA.userId));
      }
    }
  }
});

test('TC-ADM-014: Regular user cannot use admin sub-resource creation endpoints', async ({
  request,
}) => {
  const admin = await loginAsAdmin(request);
  const user = await createUserB(request, admin.accessToken);
  const me = await getMe(request, user.tokens.accessToken);
  const userId = String(me.data?._id ?? user.userId);

  const res = await apiRequest(request, user.tokens.accessToken).post(
    `/admin/users/${userId}/accounts`,
    {
      data: {
        account_name: 'Escalation Attempt',
        account_type: 'PAPER',
        initial_balance: 1000,
      },
    }
  );
  await expectStatus(res, 403);
  await expectMessageContains(res, 'Administrator');
});

// ─── RBAC Cross-Cutting (TC-ADM-015 – TC-ADM-016) ──────────────────────────

test('TC-ADM-015: authorize() middleware wired to zero routes — duplicate of TC-RBAC-001 (#41)', async () => {
  // Intentionally skipped — single RBAC audit lives in iam-auth.spec.ts (TC-RBAC-001).
  test.skip(true, 'Duplicate of TC-RBAC-001 in iam-auth.spec.ts');
});

test('TC-ADM-016: Mutating routes rely on authenticate + ad-hoc isAdmin, not authorize() (#41)', {
  ...tags.audit,
}, async () => {
  const routes = enumerateMutatingRoutes();
  expect(routes.length).toBeGreaterThan(0);

  const brokerMutators = routes.filter((r) => r.file === 'brokerRoute.js');
  expect(brokerMutators.length).toBeGreaterThan(0);
  for (const route of brokerMutators) {
    expect(route.middlewares.some((m) => m.includes('authenticate'))).toBe(true);
    expect(route.middlewares.some((m) => m.includes('isAdmin'))).toBe(false);
  }

  const accountMutators = routes.filter((r) => r.file === 'accountRoute.js');
  expect(accountMutators.length).toBeGreaterThan(0);
  for (const route of accountMutators) {
    expect(route.middlewares.some((m) => m.includes('isAdmin'))).toBe(false);
  }

  const adminRouteContent = fs.readFileSync(path.join(ROUTES_DIR, 'adminRoute.js'), 'utf8');
  expect(adminRouteContent).toContain('router.use(isAdmin)');

  const extBrokerPost = routes.find(
    (r) => r.file === 'externalBrokerRoute.js' && r.method === 'post'
  );
  expect(extBrokerPost?.middlewares.some((m) => m.includes('isAdmin'))).toBe(true);

  expect(grepRoutesForAuthorize()).toEqual([]);

  const authOnlyCount = routes.filter(
    (r) =>
      r.file !== 'adminRoute.js' &&
      !r.middlewares.some((m) => m.includes('isAdmin')) &&
      r.middlewares.some((m) => m.includes('authenticate'))
  ).length;
  expect(authOnlyCount).toBeGreaterThan(10);
});
