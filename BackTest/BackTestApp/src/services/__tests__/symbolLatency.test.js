import test from "node:test";
import assert from "node:assert/strict";
import UserSymbol from "../../models/userSymbol.js";
import { latencyKeysFor, attachCachedLatency } from "../../utils/symbolLatency.js";
import {
  getSharedRedisClient,
  getReadySharedRedisClient,
  __setRedisClientFactoryForTests,
} from "../../utils/sharedRedis.js";
import { getAllSymbols, getSymbolById } from "../symbol.js";

/** Fake node-redis client that records listeners, connects and MGETs. */
function makeFakeFactory({ ready = true, values = {}, mGetError = null } = {}) {
  const created = [];
  const factory = (options) => {
    const listeners = {};
    const client = {
      options,
      isReady: ready,
      connectCalls: 0,
      mGetCalls: [],
      listeners,
      on(event, fn) {
        (listeners[event] ||= []).push(fn);
        return client;
      },
      async connect() {
        client.connectCalls += 1;
      },
      async mGet(keys) {
        client.mGetCalls.push(keys);
        if (mGetError) throw mGetError;
        return keys.map((k) => (k in values ? values[k] : null));
      },
      async quit() {},
    };
    created.push(client);
    return client;
  };
  return { factory, created };
}

function withRedisUrl(fn) {
  return async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://fake:6379";
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prev;
      __setRedisClientFactoryForTests(null);
    }
  };
}

// ── latency keys / batching ────────────────────────────────────────────────

test("TC-SYM-LAT-001: keys are tried by symbol first, then by clean token", () => {
  assert.deepEqual(latencyKeysFor({ symbol: "RELIANCE", instrument_token: "NSE_EQ|INE002A01018" }), [
    "symbol:latency:RELIANCE",
    "symbol:latency:INE002A01018",
  ]);
  assert.deepEqual(latencyKeysFor({ symbol: "Nifty 50", instrument_token: "NSE_INDEX|Nifty 50" }), [
    "symbol:latency:Nifty 50",
  ]);
  assert.deepEqual(latencyKeysFor({}), []);
});

test("TC-SYM-LAT-002: one MGET for the whole page; symbol key wins over token key", async () => {
  const { factory, created } = makeFakeFactory({
    values: {
      "symbol:latency:A": "5",
      "symbol:latency:TOKB": "9",
      "symbol:latency:TOKA": "99",
    },
  });
  const client = factory({});
  const docs = [
    { symbol: "A", instrument_token: "NSE_EQ|TOKA" },
    { symbol: "B", instrument_token: "NSE_EQ|TOKB" },
    { symbol: "C", instrument_token: "NSE_EQ|TOKC" },
  ];
  await attachCachedLatency(docs, client);
  assert.equal(created[0].mGetCalls.length, 1);
  assert.equal(docs[0].latency_ms, 5);
  assert.equal(docs[1].latency_ms, 9);
  assert.equal("latency_ms" in docs[2], false);
});

test("TC-SYM-LAT-003: a Redis error or no client leaves documents unchanged", async () => {
  const { factory } = makeFakeFactory({ mGetError: new Error("down") });
  const docs = [{ symbol: "A" }];
  await attachCachedLatency(docs, factory({}));
  await attachCachedLatency(docs, null);
  assert.equal("latency_ms" in docs[0], false);
});

// ── shared client ──────────────────────────────────────────────────────────

test(
  "TC-SYM-LAT-004: shared client has an error listener, no offline queue, and connects once",
  withRedisUrl(async () => {
    const { factory, created } = makeFakeFactory();
    __setRedisClientFactoryForTests(factory);
    const a = getSharedRedisClient();
    const b = getSharedRedisClient();
    assert.equal(a, b);
    assert.equal(created.length, 1);
    assert.equal(a.connectCalls, 1);
    assert.equal(a.options.disableOfflineQueue, true);
    assert.ok(a.listeners.error?.length >= 1, "an error listener must be registered");
    // Emitting an error must not throw (an EventEmitter with no listener would).
    assert.doesNotThrow(() => a.listeners.error.forEach((fn) => fn(new Error("ECONNREFUSED"))));
  })
);

test(
  "TC-SYM-LAT-005: no ready client while Redis is down, so requests never wait on it",
  withRedisUrl(async () => {
    const { factory } = makeFakeFactory({ ready: false });
    __setRedisClientFactoryForTests(factory);
    assert.equal(getReadySharedRedisClient(), null);
  })
);

test("TC-SYM-LAT-006: without REDIS_URL there is no client", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    __setRedisClientFactoryForTests(makeFakeFactory().factory);
    assert.equal(getSharedRedisClient(), null);
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
    __setRedisClientFactoryForTests(null);
  }
});

// ── symbol service uses the shared client ──────────────────────────────────

function stubQueryChain(result) {
  const chain = {
    lean: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => Promise.resolve(result),
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
  return chain;
}

test(
  "TC-SYM-LAT-007: list and get-by-id reuse one client instead of connecting per request",
  withRedisUrl(async () => {
    const { factory, created } = makeFakeFactory({
      values: { "symbol:latency:RELIANCE": "12" },
    });
    __setRedisClientFactoryForTests(factory);

    const origFind = UserSymbol.find;
    const origFindOne = UserSymbol.findOne;
    const origCount = UserSymbol.countDocuments;
    UserSymbol.find = () => stubQueryChain([{ symbol: "RELIANCE", instrument_token: "NSE_EQ|INE002A01018" }]);
    UserSymbol.findOne = () => stubQueryChain({ symbol: "RELIANCE", instrument_token: "NSE_EQ|INE002A01018" });
    UserSymbol.countDocuments = async () => 1;
    try {
      const list1 = await getAllSymbols("u1", {});
      const list2 = await getAllSymbols("u1", {});
      const one = await getSymbolById("u1", "507f1f77bcf86cd799439011");
      assert.equal(list1.items[0].latency_ms, 12);
      assert.equal(list2.items[0].latency_ms, 12);
      assert.equal(one.latency_ms, 12);
      assert.equal(created.length, 1, "exactly one Redis client for all requests");
      assert.equal(created[0].connectCalls, 1);
    } finally {
      UserSymbol.find = origFind;
      UserSymbol.findOne = origFindOne;
      UserSymbol.countDocuments = origCount;
    }
  })
);
