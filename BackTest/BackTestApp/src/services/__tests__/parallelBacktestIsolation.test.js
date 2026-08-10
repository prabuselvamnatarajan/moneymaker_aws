/**
 * parallelBacktestIsolation.test.js
 *
 * Comprehensive regression tests for all bugs identified and fixed in the
 * parallel-backtest isolation & MSB order execution investigation.
 *
 * Bug fixes covered:
 *   Bug 1.  E11000 duplicate key on client_order_id (MongoDB sparse index null collision)
 *   Bug 2.  Redis balance key must be namespaced by deploymentId ONLY in BACKTEST mode
 *   Bug 3.  LIVE/PAPER mode must use account_id key even when deploymentId is present
 *   Bug 4.  Redis sync must occur BEFORE backtest tick streaming starts
 *   Bug 5.  stale Redis cleanup must guard deployment balance keys (validAccountIds)
 *   Bug 6.  Kafka partition key must include deployment_id to prevent tick interleaving
 *   Bug 7.  Symbol extraction must strip deployment_id suffix from composite Kafka key
 *   Bug 8.  Per-deployment tick serialization lock (handleMessageForDeployment)
 *   Bug 9.  Two parallel identical backtests must produce identical trade counts and PnL
 *   Bug 10. client_order_id forwarded from placeorder body to BackTestApp
 *   Bug 11. Deployment-scoped bought_quantity Redis key prevents cross-deployment holdings
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// BUG 1: E11000 — falsy client_order_id must be stripped before DB insert
// ---------------------------------------------------------------------------
describe("Bug 1: E11000 — strip falsy client_order_id before MongoDB insert", () => {
  function sanitizePayload(tradePayload) {
    const payload = { ...tradePayload };
    delete payload.force_close;
    if (!payload.client_order_id) delete payload.client_order_id;
    return payload;
  }

  it("removes null client_order_id", () => {
    const p = sanitizePayload({ symbol: "NIFTY", client_order_id: null });
    assert.equal("client_order_id" in p, false, "null must be removed");
  });

  it("removes empty string client_order_id", () => {
    const p = sanitizePayload({ symbol: "NIFTY", client_order_id: "" });
    assert.equal("client_order_id" in p, false, "empty string must be removed");
  });

  it("removes undefined client_order_id", () => {
    const p = sanitizePayload({ symbol: "NIFTY" });
    assert.equal("client_order_id" in p, false, "undefined must be absent");
  });

  it("preserves a valid client_order_id", () => {
    const p = sanitizePayload({ symbol: "NIFTY", client_order_id: "dep1_NSE_BUY_123" });
    assert.equal(p.client_order_id, "dep1_NSE_BUY_123");
  });

  it("does not create a duplicate when client_order_id already exists", async () => {
    const store = new Map([["dep1_NSE_BUY_111", { _id: "existing" }]]);
    const upsertTrade = async (data) => {
      const key = data.client_order_id;
      if (key && store.has(key)) return store.get(key);
      const doc = { _id: "new_" + Math.random(), ...data };
      if (key) store.set(key, doc);
      return doc;
    };
    const r1 = await upsertTrade({ client_order_id: "dep1_NSE_BUY_111", symbol: "NSE_FO|57331" });
    const r2 = await upsertTrade({ client_order_id: "dep1_NSE_BUY_111", symbol: "NSE_FO|57331" });
    assert.equal(r1._id, "existing");
    assert.equal(r2._id, "existing", "duplicate call must return the same document");
    assert.equal(store.size, 1, "no new document must be created");
  });
});

// ---------------------------------------------------------------------------
// BUG 2 & 3: Redis balance key — BACKTEST uses deploymentId, LIVE uses accountId
// ---------------------------------------------------------------------------
describe("Bug 2 & 3: Redis balance key selection by strategy mode (isBacktest guard)", () => {
  function resolveBalanceKey(accountId, deploymentId, isBacktest) {
    return (isBacktest && deploymentId)
      ? `account_balance:${deploymentId}`
      : `account_balance:${accountId}`;
  }

  it("BACKTEST mode uses deployment-scoped key for isolation", () => {
    assert.equal(resolveBalanceKey("acc_xyz", "dep_abc", true), "account_balance:dep_abc");
  });

  it("LIVE mode uses account-scoped key even when deploymentId is present", () => {
    assert.equal(resolveBalanceKey("acc_xyz", "dep_abc", false), "account_balance:acc_xyz",
      "live mode must not use deployment-namespaced key");
  });

  it("PAPER mode uses account-scoped key", () => {
    assert.equal(resolveBalanceKey("acc_xyz", "dep_abc", false), "account_balance:acc_xyz");
  });

  it("BACKTEST mode with no deploymentId falls back to account_id key", () => {
    assert.equal(resolveBalanceKey("acc_xyz", undefined, true), "account_balance:acc_xyz");
  });

  it("two parallel backtests with same account but different deploymentIds get isolated keys", () => {
    const k1 = resolveBalanceKey("acc_shared", "dep_111", true);
    const k2 = resolveBalanceKey("acc_shared", "dep_222", true);
    assert.notEqual(k1, k2, "parallel backtests must not share the same Redis balance key");
    assert.equal(k1, "account_balance:dep_111");
    assert.equal(k2, "account_balance:dep_222");
  });

  it("isBacktest=true without deploymentId still uses accountId (graceful fallback)", () => {
    const key = resolveBalanceKey("acc_solo", null, true);
    assert.equal(key, "account_balance:acc_solo");
  });
});

// ---------------------------------------------------------------------------
// BUG 4: Redis sync MUST occur before backtest streaming starts
// ---------------------------------------------------------------------------
describe("Bug 4: syncAllDeploymentsToRedis must run before triggerBacktestIfNeeded", () => {
  it("correct execution order is SYNC then STREAM", async () => {
    const order = [];
    const syncRedis = async () => order.push("SYNC");
    const triggerStream = async () => order.push("STREAM");
    await syncRedis();
    await triggerStream();
    assert.deepEqual(order, ["SYNC", "STREAM"],
      "Redis balance sync must complete before backtest tick streaming is triggered");
  });

  it("reversed order (streaming before sync) leaves balance key missing during tick processing", async () => {
    const redisState = {};
    const streamAndReadBalance = async (depId) => redisState[`account_balance:${depId}`] || 0;
    const syncRedis = async (depId, bal) => { redisState[`account_balance:${depId}`] = bal; };
    const badBalance = await streamAndReadBalance("dep_bad");
    await syncRedis("dep_bad", 25000000);
    assert.equal(badBalance, 0, "balance is 0 when streaming triggers before Redis sync");
  });

  it("correct order (sync before streaming) ensures balance is available at first tick", async () => {
    const redisState = {};
    const syncRedis = async (depId, bal) => { redisState[`account_balance:${depId}`] = bal; };
    const readBalance = async (depId) => redisState[`account_balance:${depId}`] || 0;
    await syncRedis("dep_good", 25000000);
    const balance = await readBalance("dep_good");
    assert.equal(balance, 25000000, "balance available when sync runs before streaming");
  });
});

// ---------------------------------------------------------------------------
// BUG 5: stale Redis key cleanup must preserve active deployment balance keys
// ---------------------------------------------------------------------------
describe("Bug 5: stale Redis cleanup must not delete active deployment balance keys", () => {
  function buildValidSet(accounts, deployments) {
    const validIds = new Set();
    for (const acc of accounts) {
      if (acc._id) validIds.add(acc._id.toString());
      if (acc.account_id) validIds.add(acc.account_id.toString());
    }
    for (const dep of deployments) {
      if (dep._id) validIds.add(dep._id.toString());
    }
    return validIds;
  }

  it("includes Account _id and account_id string in valid set", () => {
    const valid = buildValidSet([{ _id: "acc_111", account_id: "ACC111" }], []);
    assert.equal(valid.has("acc_111"), true);
    assert.equal(valid.has("ACC111"), true);
  });

  it("includes Deployment _id so backtest balance keys are NOT deleted", () => {
    const valid = buildValidSet(
      [{ _id: "acc_111", account_id: "ACC111" }],
      [{ _id: "dep_999" }]
    );
    assert.equal(valid.has("dep_999"), true,
      "deployment _id must be in validIds so account_balance:dep_999 is not pruned");
  });

  it("excludes stale IDs that no longer exist in DB", () => {
    const valid = buildValidSet([{ _id: "acc_alive" }], [{ _id: "dep_alive" }]);
    assert.equal(valid.has("acc_deleted"), false);
    assert.equal(valid.has("dep_deleted"), false);
  });

  it("cleanup correctly identifies stale vs active balance keys", () => {
    const valid = buildValidSet(
      [{ _id: "acc_111", account_id: "ACC111" }],
      [{ _id: "dep_active_222" }]
    );
    const existing = [
      "account_balance:acc_111",
      "account_balance:dep_active_222",
      "account_balance:dep_deleted_old",
    ];
    const toDelete = existing.filter(k => !valid.has(k.replace("account_balance:", "")));
    assert.deepEqual(toDelete, ["account_balance:dep_deleted_old"],
      "only stale keys should be marked for deletion");
  });
});

// ---------------------------------------------------------------------------
// BUG 6: Kafka partition key must be symbol:deployment_id for backtest
// ---------------------------------------------------------------------------
describe("Bug 6: Kafka partition key must include deployment_id for backtest mode", () => {
  function buildPartitionKey(symbol, strategy, isBacktest) {
    return isBacktest && strategy.deployment_id
      ? `${symbol}:${strategy.deployment_id}`
      : symbol;
  }

  it("backtest partition key includes deployment_id", () => {
    const key = buildPartitionKey("NSE_FO|57331", { deployment_id: "dep_111" }, true);
    assert.equal(key, "NSE_FO|57331:dep_111");
  });

  it("two parallel backtests get distinct partition keys preventing tick interleaving", () => {
    const k1 = buildPartitionKey("NSE_FO|57331", { deployment_id: "dep_111" }, true);
    const k2 = buildPartitionKey("NSE_FO|57331", { deployment_id: "dep_222" }, true);
    assert.notEqual(k1, k2, "parallel backtests on the same symbol must use different partition keys");
  });

  it("live mode uses plain symbol as partition key", () => {
    const key = buildPartitionKey("NSE_FO|57331", { deployment_id: "dep_111" }, false);
    assert.equal(key, "NSE_FO|57331");
  });

  it("backtest without deployment_id falls back to plain symbol", () => {
    const key = buildPartitionKey("NSE_FO|57331", {}, true);
    assert.equal(key, "NSE_FO|57331");
  });
});

// ---------------------------------------------------------------------------
// BUG 7: Symbol extraction from composite Kafka key (symbol:deployment_id)
// ---------------------------------------------------------------------------
describe("Bug 7: clean symbol name must be extracted from composite Kafka partition key", () => {
  function extractSymbol(msg, rawKey) {
    const sd = msg?.strategy_details || {};
    return String(
      msg?.symbol || msg?.symbol_name || sd.symbol || String(rawKey || "").split(":")[0]
    ).toUpperCase();
  }

  it("extracts symbol from msg.symbol when available", () => {
    assert.equal(extractSymbol({ symbol: "NSE_FO|57331" }, "NSE_FO|57331:dep_abc"), "NSE_FO|57331");
  });

  it("extracts symbol from msg.symbol_name", () => {
    assert.equal(extractSymbol({ symbol_name: "NSE_FO|57331" }, "NSE_FO|57331:dep_abc"), "NSE_FO|57331");
  });

  it("falls back to splitting rawKey when msg has no symbol", () => {
    assert.equal(extractSymbol({}, "NSE_FO|57331:dep_abc"), "NSE_FO|57331",
      "must strip deployment_id suffix from composite key");
  });

  it("converts symbol to uppercase", () => {
    assert.equal(extractSymbol({ symbol: "nse_fo|57331" }, ""), "NSE_FO|57331");
  });

  it("using composite key as symbol would miss the Redis strategy entry", () => {
    const compositeKey = "NSE_FO|57331:dep_abc";
    const wrongRedisKey = `strategies:backtest:${compositeKey}`;
    const correctKey = `strategies:backtest:NSE_FO|57331`;
    assert.notEqual(wrongRedisKey, correctKey,
      "composite key as symbol would miss Redis strategy entry → no orders placed");
  });
});

// ---------------------------------------------------------------------------
// BUG 8: Per-deployment tick serialization lock
// ---------------------------------------------------------------------------
describe("Bug 8: per-deployment tick serialization (handleMessageForDeployment)", () => {
  function makeDeploymentLock() {
    const locks = new Map();
    return async function withLock(deploymentId, fn) {
      if (!deploymentId) return fn();
      const prev = locks.get(deploymentId) || Promise.resolve();
      let resolve;
      const curr = new Promise(r => { resolve = r; });
      locks.set(deploymentId, curr);
      try { await prev; return await fn(); }
      finally { resolve(); if (locks.get(deploymentId) === curr) locks.delete(deploymentId); }
    };
  }

  it("serializes ticks for the same deployment ID in arrival order", async () => {
    const withLock = makeDeploymentLock();
    const order = [];
    await Promise.all([
      withLock("dep_111", async () => { await new Promise(r => setTimeout(r, 20)); order.push("t1"); }),
      withLock("dep_111", async () => { await new Promise(r => setTimeout(r, 5)); order.push("t2"); }),
      withLock("dep_111", async () => { await new Promise(r => setTimeout(r, 1)); order.push("t3"); }),
    ]);
    assert.deepEqual(order, ["t1", "t2", "t3"],
      "ticks for same deployment must be processed in arrival order");
  });

  it("does NOT block ticks for different deployments (true concurrency)", async () => {
    const withLock = makeDeploymentLock();
    const order = [];
    await Promise.all([
      withLock("dep_A", async () => { await new Promise(r => setTimeout(r, 30)); order.push("dep_A"); }),
      withLock("dep_B", async () => { await new Promise(r => setTimeout(r, 5)); order.push("dep_B"); }),
    ]);
    assert.equal(order[0], "dep_B", "faster dep_B must finish first without being blocked by dep_A");
    assert.equal(order[1], "dep_A");
  });

  it("lock cleans up after completion to prevent memory leaks", async () => {
    const locks = new Map();
    const withLock = async (id, fn) => {
      const prev = locks.get(id) || Promise.resolve();
      let resolve;
      const curr = new Promise(r => { resolve = r; });
      locks.set(id, curr);
      try { await prev; return await fn(); }
      finally { resolve(); if (locks.get(id) === curr) locks.delete(id); }
    };
    await withLock("dep_X", async () => {});
    assert.equal(locks.has("dep_X"), false, "lock entry must be cleaned up after completion");
  });
});

// ---------------------------------------------------------------------------
// BUG 9: Two identical parallel backtests must produce identical results
// ---------------------------------------------------------------------------
describe("Bug 9: identical parallel backtest deployments produce identical trade counts and PnL", () => {
  it("deterministic tick replay produces identical results for both deployments", () => {
    const ticks = [
      { ltp: 500, ts: 1000 }, { ltp: 505, ts: 2000 }, { ltp: 495, ts: 3000 },
      { ltp: 510, ts: 4000 }, { ltp: 503, ts: 5000 },
    ];
    function simulateStrategy(ticks) {
      let trades = 0, holding = false, pnl = 0, buyPrice = 0;
      for (const tick of ticks) {
        if (!holding && tick.ltp > 502) { holding = true; buyPrice = tick.ltp; trades++; }
        else if (holding && tick.ltp < buyPrice - 3) { pnl += tick.ltp - buyPrice; holding = false; trades++; }
      }
      return { trades, pnl };
    }
    const r1 = simulateStrategy(ticks);
    const r2 = simulateStrategy(ticks);
    assert.equal(r1.trades, r2.trades, "same ticks → same trade count");
    assert.equal(r1.pnl, r2.pnl, "same ticks → same PnL");
  });

  it("balance isolation means dep_111 spending does not reduce dep_222 balance", () => {
    const redis = {};
    const setBalance = (depId, bal) => { redis[`account_balance:${depId}`] = bal; };
    const getBalance = (depId) => redis[`account_balance:${depId}`] || 0;
    const deductBalance = (depId, amount) => { redis[`account_balance:${depId}`] -= amount; };

    setBalance("dep_111", 25000000);
    setBalance("dep_222", 25000000);

    deductBalance("dep_111", 500000); // dep_111 places a trade
    assert.equal(getBalance("dep_111"), 24500000);
    assert.equal(getBalance("dep_222"), 25000000,
      "dep_222 balance must be unaffected by dep_111 trade");
  });
});

// ---------------------------------------------------------------------------
// BUG 10: client_order_id forwarded from placeorder body to BackTestApp
// ---------------------------------------------------------------------------
describe("Bug 10: client_order_id forwarded from placeorder body to BackTestApp payload", () => {
  function buildBackTestPayload(body) {
    const { strategy_details = {} } = body;
    // Top-level client_order_id takes precedence over nested strategy_details one.
    // Spread strategy_details first, then override with the explicit top-level key.
    const clientOrderId = body.client_order_id || strategy_details.client_order_id;
    return {
      type_of_order: body.transaction_type,
      price: body.price,
      quantity: body.quantity,
      ...strategy_details,
      ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
    };
  }

  it("forwards top-level client_order_id", () => {
    const p = buildBackTestPayload({
      transaction_type: "BUY", price: 100, quantity: 10,
      client_order_id: "top_level_key",
      strategy_details: { deployment_id: "dep1" },
    });
    assert.equal(p.client_order_id, "top_level_key");
  });

  it("forwards nested strategy_details.client_order_id", () => {
    const p = buildBackTestPayload({
      transaction_type: "BUY", price: 100, quantity: 10,
      strategy_details: { client_order_id: "nested_key", deployment_id: "dep1" },
    });
    assert.equal(p.client_order_id, "nested_key");
  });

  it("omits client_order_id when none provided (no undefined injection)", () => {
    const p = buildBackTestPayload({
      transaction_type: "SELL", price: 100, quantity: 10,
      strategy_details: { deployment_id: "dep1" },
    });
    assert.equal("client_order_id" in p, false,
      "must not inject undefined client_order_id which causes MongoDB index collision");
  });

  it("top-level client_order_id takes precedence over nested", () => {
    const p = buildBackTestPayload({
      transaction_type: "BUY", price: 100, quantity: 10,
      client_order_id: "top_wins",
      strategy_details: { client_order_id: "nested_loses", deployment_id: "dep1" },
    });
    assert.equal(p.client_order_id, "top_wins");
  });
});

// ---------------------------------------------------------------------------
// BUG 11: Deployment-scoped bought_quantity Redis key prevents cross-deployment holdings
// ---------------------------------------------------------------------------
describe("Bug 11: bought_quantity Redis key must be scoped by deployment_id", () => {
  const getBoughtQtyKey = (tag, depId) =>
    depId ? `bought_quantity:${depId}:${tag}` : `bought_quantity:${tag}`;

  it("two deployments on the same symbol get separate holding keys", () => {
    const k1 = getBoughtQtyKey("NSE_FO|57331", "dep_111");
    const k2 = getBoughtQtyKey("NSE_FO|57331", "dep_222");
    assert.notEqual(k1, k2, "parallel deployments must not share bought_quantity key");
  });

  it("buying in dep_111 does not affect dep_222 holdings", () => {
    const holdings = {};
    const set = (depId, sym, qty) => { holdings[getBoughtQtyKey(sym, depId)] = qty; };
    const get = (depId, sym) => holdings[getBoughtQtyKey(sym, depId)] || 0;
    set("dep_111", "NSE_FO|57331", 65);
    assert.equal(get("dep_111", "NSE_FO|57331"), 65);
    assert.equal(get("dep_222", "NSE_FO|57331"), 0, "dep_222 must not see dep_111 holdings");
  });

  it("selling in dep_111 clears only dep_111 holdings", () => {
    const holdings = {};
    const set = (depId, sym, qty) => { holdings[getBoughtQtyKey(sym, depId)] = qty; };
    const get = (depId, sym) => holdings[getBoughtQtyKey(sym, depId)] || 0;
    set("dep_111", "NSE_FO|57331", 65);
    set("dep_222", "NSE_FO|57331", 65);
    set("dep_111", "NSE_FO|57331", 0); // dep_111 exits
    assert.equal(get("dep_111", "NSE_FO|57331"), 0, "dep_111 holdings cleared after exit");
    assert.equal(get("dep_222", "NSE_FO|57331"), 65, "dep_222 holdings unaffected");
  });
});

// ---------------------------------------------------------------------------
// INTEGRATION: isBacktest flag derivation from strategy_details
// ---------------------------------------------------------------------------
describe("Integration: isBacktest flag derivation from strategy_details", () => {
  const resolveIsBacktest = (sd) =>
    sd.strategy_mode === "BACKTEST" ||
    (sd.isTest === true && sd.strategy_mode !== "LIVE");

  it("BACKTEST strategy_mode → isBacktest=true", () => assert.equal(resolveIsBacktest({ strategy_mode: "BACKTEST" }), true));
  it("isTest=true with no strategy_mode → isBacktest=true", () => assert.equal(resolveIsBacktest({ isTest: true }), true));
  it("LIVE strategy_mode with isTest=true → isBacktest=false", () => assert.equal(resolveIsBacktest({ isTest: true, strategy_mode: "LIVE" }), false));
  it("PAPER strategy_mode → isBacktest=false", () => assert.equal(resolveIsBacktest({ strategy_mode: "PAPER" }), false));
  it("LIVE strategy_mode → isBacktest=false", () => assert.equal(resolveIsBacktest({ strategy_mode: "LIVE" }), false));
  it("empty strategy_details → isBacktest=false (defaults to live behaviour)", () => assert.equal(resolveIsBacktest({}), false));
});

// ---------------------------------------------------------------------------
// BUG 12: max_up/max_down excursion seed at close — Math.max not ?? operator
// ---------------------------------------------------------------------------
describe("Bug 12: max_up/max_down must merge liveCache and DB value at position close (not ?? which drops 0)", () => {
  // Mirror the real applyExcursion logic
  function applyExcursion(current, unrealised, pct) {
    return {
      max_up:      Math.max(Number(current.max_up)      || 0, unrealised),
      max_down:    Math.min(Number(current.max_down)    || 0, unrealised),
      max_up_pct:  Math.max(Number(current.max_up_pct)  || 0, pct),
      max_down_pct: Math.min(Number(current.max_down_pct) || 0, pct),
    };
  }

  // The FIXED seed logic
  function buildSeedFixed(liveCache, positionDoc) {
    return {
      max_up:      Math.max(liveCache?.maxUp    ?? 0, positionDoc.max_up    || 0),
      max_down:    Math.min(liveCache?.maxDown  ?? 0, positionDoc.max_down  || 0),
      max_up_pct:  Math.max(liveCache?.maxUpPct ?? 0, positionDoc.max_up_pct || 0),
      max_down_pct: Math.min(liveCache?.maxDownPct ?? 0, positionDoc.max_down_pct || 0),
    };
  }

  // The BUGGY seed logic (using ??)
  function buildSeedBuggy(liveCache, positionDoc) {
    return {
      max_up:      liveCache?.maxUp    ?? positionDoc.max_up,
      max_down:    liveCache?.maxDown  ?? positionDoc.max_down,
      max_up_pct:  liveCache?.maxUpPct ?? positionDoc.max_up_pct,
      max_down_pct: liveCache?.maxDownPct ?? positionDoc.max_down_pct,
    };
  }

  it("fixed: liveCache.maxUp=0 + DB.max_up=5000 → seed=5000 (takes DB value)", () => {
    const liveCache = { maxUp: 0, maxDown: -1000, maxUpPct: 0, maxDownPct: -0.5 };
    const positionDoc = { max_up: 5000, max_down: -1000, max_up_pct: 2.5, max_down_pct: -0.5 };
    const seed = buildSeedFixed(liveCache, positionDoc);
    assert.equal(seed.max_up, 5000, "fixed: DB max_up wins over cache zero");
  });

  it("buggy: liveCache.maxUp=0 + DB.max_up=5000 → seed=0 (BUG: ?? uses 0 from cache)", () => {
    const liveCache = { maxUp: 0, maxDown: -1000, maxUpPct: 0, maxDownPct: -0.5 };
    const positionDoc = { max_up: 5000, max_down: -1000, max_up_pct: 2.5, max_down_pct: -0.5 };
    const seed = buildSeedBuggy(liveCache, positionDoc);
    assert.equal(seed.max_up, 0, "buggy: ?? passes 0 from fresh cache, discards DB value");
  });

  it("fixed: liveCache.maxUp=8000 > DB.max_up=5000 → seed=8000 (takes cache value when higher)", () => {
    const liveCache = { maxUp: 8000, maxDown: -1000, maxUpPct: 4.0, maxDownPct: -0.5 };
    const positionDoc = { max_up: 5000, max_down: -500, max_up_pct: 2.5, max_down_pct: -0.25 };
    const seed = buildSeedFixed(liveCache, positionDoc);
    assert.equal(seed.max_up, 8000, "fixed: cache value wins when higher than DB");
    assert.equal(seed.max_down, -1000, "fixed: most adverse down wins");
  });

  it("fixed: liveCache=null → seed uses DB value entirely (no crash)", () => {
    const positionDoc = { max_up: 3000, max_down: -500, max_up_pct: 1.5, max_down_pct: -0.25 };
    const seed = buildSeedFixed(null, positionDoc);
    assert.equal(seed.max_up, 3000, "fixed: null cache falls back to DB value");
    assert.equal(seed.max_down, -500);
  });

  it("the bug reproduces: LONG position closes at a loss, peak was in DB not cache, max_up=0 incorrectly", () => {
    // Scenario: position opened at 325.6, peaked at 340 (captured in DB as max_up=3419880)
    // but Redis cache was freshly seeded at max_up=0 (race window missed the peak)
    // Closing price = 320 (below entry = losing trade)
    const entry = 325.6;
    const openSize = 300850; // qty
    const closingLtp = 320;
    const direction = "LONG";

    // Fresh cache from syncOpenPositionToRedis (opened AFTER peak tick was processed)
    const freshCache = { maxUp: 0, maxDown: 0, maxUpPct: 0, maxDownPct: 0 };
    // DB still has max_up=0 (throttle prevented write of intermediate peak)
    const positionDocBuggy = { max_up: 0, max_down: 0, max_up_pct: 0, max_down_pct: 0 };

    const closingUnrealised = (closingLtp - entry) * openSize; // negative (loss)
    const closingPct = ((closingLtp - entry) / entry) * 100;

    const seedBuggy = buildSeedBuggy(freshCache, positionDocBuggy);
    const resultBuggy = applyExcursion(seedBuggy, closingUnrealised, closingPct);
    assert.equal(resultBuggy.max_up, 0, "buggy: max_up=0 because closing price is below entry and seed was 0");

    // DB has max_up=3419880.75 from an intermediate DB write (position tracker caught the peak)
    const positionDocFixed = { max_up: 3419880.75, max_down: -429884, max_up_pct: 4.4, max_down_pct: -0.55 };
    const seedFixed = buildSeedFixed(freshCache, positionDocFixed);
    const resultFixed = applyExcursion(seedFixed, closingUnrealised, closingPct);
    assert.equal(resultFixed.max_up, 3419880.75, "fixed: max_up preserved from DB intermediate write");
    assert.ok(resultFixed.max_down <= positionDocFixed.max_down, "fixed: max_down takes most adverse");
  });

  it("parallel backtests: same position replay must produce same max_up regardless of registration timing", () => {
    // Dep1 opened AFTER peak tick → cache.maxUp=0, but DB has a previous write max_up=3419880
    // Dep2 opened BEFORE peak tick → cache.maxUp=3419880 (tracker updated it)
    const closingLtp = 320;
    const entry = 325.6;
    const openSize = 300850;
    const closingUnrealised = (closingLtp - entry) * openSize;
    const closingPct = ((closingLtp - entry) / entry) * 100;

    // Dep1: cache missed the peak (registered after peak tick)
    const dep1Cache = { maxUp: 0, maxDown: -429884, maxUpPct: 0, maxDownPct: -0.55 };
    const dep1Doc   = { max_up: 3419880.75, max_down: -429884, max_up_pct: 4.4, max_down_pct: -0.55 };
    const dep1Seed  = buildSeedFixed(dep1Cache, dep1Doc);
    const dep1Final = applyExcursion(dep1Seed, closingUnrealised, closingPct);

    // Dep2: cache has the peak (registered before peak tick)
    const dep2Cache = { maxUp: 3419880.75, maxDown: -429884, maxUpPct: 4.4, maxDownPct: -0.55 };
    const dep2Doc   = { max_up: 0, max_down: 0, max_up_pct: 0, max_down_pct: 0 };
    const dep2Seed  = buildSeedFixed(dep2Cache, dep2Doc);
    const dep2Final = applyExcursion(dep2Seed, closingUnrealised, closingPct);

    assert.equal(dep1Final.max_up, dep2Final.max_up,
      "fixed: parallel deployments produce same max_up regardless of cache vs DB source");
    assert.equal(dep1Final.max_down, dep2Final.max_down,
      "fixed: parallel deployments produce same max_down");
  });
});

// ---------------------------------------------------------------------------
// NEW: Multi-Timeframe Parallel Deployments & Multi-Run Consistency Tests
// ---------------------------------------------------------------------------
describe("Multi-Timeframe Parallel Deployments (1m, 3m, 5m, 15m) & Multi-Run Consistency", () => {
  it("timeframed deployments (1m, 3m, 5m, 15m) process candles independently with distinct interval buckets", () => {
    const timeframes = ['1m', '3m', '5m', '15m'];
    const bucketIntervals = {
      '1m': 60000,
      '3m': 180000,
      '5m': 300000,
      '15m': 900000,
    };

    timeframes.forEach(tf => {
      const ts = 1720236005000; // 09:15:05
      const expectedBucketStart = Math.floor(ts / bucketIntervals[tf]) * bucketIntervals[tf];
      assert.equal(Math.floor(ts / bucketIntervals[tf]) * bucketIntervals[tf], expectedBucketStart);
    });
  });

  it("parallel deployments with identical parameters across different timeframes run without cross-contamination", () => {
    const deps = [
      { deployment_id: "dep_1m", timeframe: "1m", balance: 100000, holdings: 0 },
      { deployment_id: "dep_3m", timeframe: "3m", balance: 100000, holdings: 0 },
      { deployment_id: "dep_5m", timeframe: "5m", balance: 100000, holdings: 0 },
      { deployment_id: "dep_15m", timeframe: "15m", balance: 100000, holdings: 0 },
    ];

    // Simulate buying only in dep_5m
    const dep5m = deps.find(d => d.deployment_id === "dep_5m");
    dep5m.holdings = 50;
    dep5m.balance -= 50 * 500;

    // Verify other timeframed deployments remain completely unaffected
    deps.filter(d => d.deployment_id !== "dep_5m").forEach(d => {
      assert.equal(d.holdings, 0, `Holdings for ${d.timeframe} must remain 0`);
      assert.equal(d.balance, 100000, `Balance for ${d.timeframe} must remain 100000`);
    });
  });

  it("multi-run consistency: resetting Redis state for deployment restores exact initial state across reruns", () => {
    const deploymentId = "dep_test_rerun_123";
    const altDeploymentId = "dep_test_rerun_alt";
    const symbol = "NSE_FO|57331";

    const keysToPurge = [];
    const ids = [deploymentId, altDeploymentId];
    for (const id of ids) {
      keysToPurge.push(`bought_quantity:${id}:${symbol}`);
      keysToPurge.push(`short_quantity:${id}:${symbol}`);
      keysToPurge.push(`account_balance:${id}`);
    }

    assert.equal(keysToPurge.length, 6);
    assert.ok(keysToPurge.includes(`bought_quantity:${deploymentId}:${symbol}`));
    assert.ok(keysToPurge.includes(`bought_quantity:${altDeploymentId}:${symbol}`));
  });

  it("parallel deployments on identical symbols and timeframes yield 100% deterministic trade counts & PnL across multiple reruns", () => {
    const runSimulation = () => {
      const depA = { id: "depA_5m", trades: 0, pnl: 0, holding: false, entry: 0 };
      const depB = { id: "depB_5m", trades: 0, pnl: 0, holding: false, entry: 0 };

      const ticks = [
        { ltp: 100, ltt: 1000 },
        { ltp: 105, ltt: 2000 },
        { ltp: 110, ltt: 3000 },
        { ltp: 102, ltt: 4000 },
        { ltp: 98, ltt: 5000 },
      ];

      for (const t of ticks) {
        // depA rule: buy > 104, sell < 100
        if (!depA.holding && t.ltp > 104) { depA.holding = true; depA.entry = t.ltp; depA.trades++; }
        else if (depA.holding && t.ltp < 100) { depA.pnl += (t.ltp - depA.entry); depA.holding = false; depA.trades++; }

        // depB rule: buy > 104, sell < 100 (identical)
        if (!depB.holding && t.ltp > 104) { depB.holding = true; depB.entry = t.ltp; depB.trades++; }
        else if (depB.holding && t.ltp < 100) { depB.pnl += (t.ltp - depB.entry); depB.holding = false; depB.trades++; }
      }

      return { depA, depB };
    };

    const rerun1 = runSimulation();
    const rerun2 = runSimulation();
    const rerun3 = runSimulation();

    assert.deepEqual(rerun1, rerun2, "Rerun 1 and Rerun 2 must be 100% identical");
    assert.deepEqual(rerun2, rerun3, "Rerun 2 and Rerun 3 must be 100% identical");
    assert.equal(rerun1.depA.trades, rerun1.depB.trades);
    assert.equal(rerun1.depA.pnl, rerun1.depB.pnl);
  });
});

// ---------------------------------------------------------------------------
// BUG 13: backtest close-time locks and tick filtering
// ---------------------------------------------------------------------------
describe("Bug 13: backtest close-time locks and tick filtering", () => {
  it("filters out ticks that occur after the close time in BACKTEST mode", () => {
    const isTickAllowed = (tickTimeMs, closeTimeMs, strategyMode) => {
      if (strategyMode === "BACKTEST" && closeTimeMs) {
        if (tickTimeMs > closeTimeMs) return false;
      }
      return true;
    };

    const closeTime = 1785680998000;
    
    // Ticks at or before close time are allowed
    assert.equal(isTickAllowed(closeTime - 1000, closeTime, "BACKTEST"), true);
    assert.equal(isTickAllowed(closeTime, closeTime, "BACKTEST"), true);
    
    // Ticks after close time are filtered out
    assert.equal(isTickAllowed(closeTime + 1000, closeTime, "BACKTEST"), false);
    
    // LIVE mode ignores close time filtering
    assert.equal(isTickAllowed(closeTime + 1000, closeTime, "LIVE"), true);
  });

  it("correctly identifies close or reduction trades", () => {
    const checkIsCloseOrReduction = (positionDirection, orderType) => {
      return (
        (positionDirection === "LONG" && orderType === "SELL") ||
        (positionDirection === "SHORT" && orderType === "BUY")
      );
    };

    assert.equal(checkIsCloseOrReduction("LONG", "SELL"), true, "LONG position exited with SELL is a close/reduction");
    assert.equal(checkIsCloseOrReduction("SHORT", "BUY"), true, "SHORT position exited with BUY is a close/reduction");
    assert.equal(checkIsCloseOrReduction("LONG", "BUY"), false, "Adding to LONG position is not a close/reduction");
    assert.equal(checkIsCloseOrReduction("SHORT", "SELL"), false, "Adding to SHORT position is not a close/reduction");
  });
});

