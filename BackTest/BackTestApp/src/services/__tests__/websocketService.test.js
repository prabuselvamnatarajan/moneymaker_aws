import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenMatchesSubscription,
  extractSubscribedTokens,
} from "../websocketService.js";

test("tokenMatchesSubscription correctly matches token variants", () => {
  const subscribedTokens = new Set([
    "NSE_EQ|INE002A01018",
    "INE002A01018",
    "RELIANCE",
    "NSE_INDEX|Nifty 50",
    "Nifty 50",
  ]);

  // Exact match
  assert.equal(tokenMatchesSubscription(subscribedTokens, "NSE_EQ|INE002A01018"), true);

  // Suffix match
  assert.equal(tokenMatchesSubscription(subscribedTokens, "INE002A01018"), true);

  // Symbol / Ticker match
  assert.equal(tokenMatchesSubscription(subscribedTokens, "RELIANCE"), true);

  // Index match with exchange prefix
  assert.equal(tokenMatchesSubscription(subscribedTokens, "NSE_INDEX|Nifty 50"), true);
  assert.equal(tokenMatchesSubscription(subscribedTokens, "Nifty 50"), true);

  // Non-matching token
  assert.equal(tokenMatchesSubscription(subscribedTokens, "TCS"), false);
  assert.equal(tokenMatchesSubscription(subscribedTokens, "NSE_EQ|INE467B01029"), false);

  // Safeguards against null / empty / malformed
  assert.equal(tokenMatchesSubscription(null, "RELIANCE"), false);
  assert.equal(tokenMatchesSubscription(undefined, "RELIANCE"), false);
  assert.equal(tokenMatchesSubscription(new Set(), "RELIANCE"), false);
});

test("extractSubscribedTokens captures instrument_token, suffix, and symbol", () => {
  const symbolsList = [
    {
      instrument_token: "NSE_EQ|INE002A01018",
      symbol: "RELIANCE",
      symbol_name: "Reliance Industries",
    },
    {
      instrument_token: "NSE_INDEX|Nifty 50",
      symbol: "NIFTY50",
      symbol_name: "Nifty 50",
    },
  ];

  const tokens = extractSubscribedTokens(symbolsList);

  assert.ok(tokens.has("NSE_EQ|INE002A01018"));
  assert.ok(tokens.has("INE002A01018"));
  assert.ok(tokens.has("RELIANCE"));
  assert.ok(tokens.has("Reliance Industries"));

  assert.ok(tokens.has("NSE_INDEX|Nifty 50"));
  assert.ok(tokens.has("Nifty 50"));
  assert.ok(tokens.has("NIFTY50"));

  // Empty or undefined lists
  const emptyTokens = extractSubscribedTokens([]);
  assert.equal(emptyTokens.size, 0);

  const undefinedTokens = extractSubscribedTokens(undefined);
  assert.equal(undefinedTokens.size, 0);
});

// ── handleMarketDataMessage (TC-WS-LAT-*) ──────────────────────────────────
import { handleMarketDataMessage } from "../websocketService.js";

function fakeRedis() {
  const calls = { setEx: [], publish: [] };
  return {
    calls,
    isOpen: true,
    setEx: async (...args) => { calls.setEx.push(args); },
    publish: async (...args) => { calls.publish.push(args); },
  };
}

function fakeSocket(tokens) {
  const sent = [];
  return {
    sent,
    entry: {
      subscribedTokens: new Set(tokens),
      ws: { OPEN: 1, readyState: 1, send: (m) => sent.push(JSON.parse(m)) },
    },
  };
}

function kafkaMessage(key, value) {
  return { key: Buffer.from(key), value: Buffer.from(JSON.stringify(value)) };
}

test("TC-WS-LAT-001: a live tick with latency reaches the subscribed socket (no ReferenceError)", async () => {
  const redis = fakeRedis();
  const sock = fakeSocket(["NSE_EQ|INE002A01018"]);
  const sockets = new Map([["s1", sock.entry]]);
  await handleMarketDataMessage(
    "splited-live-data",
    kafkaMessage("NSE_EQ|INE002A01018", {
      ltpc: { ltp: 2500.5, cp: 2490 },
      symbol_name: "RELIANCE",
      latency: { beforeSplit: 12.4 },
    }),
    { redis, sockets }
  );
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].last_price, 2500.5);
  assert.equal(sock.sent[0].latency_ms, 12.4);
});

test("TC-WS-LAT-002: latency is cached under the symbol name and the clean token", async () => {
  const redis = fakeRedis();
  await handleMarketDataMessage(
    "splited-live-data",
    kafkaMessage("NSE_EQ|INE002A01018", {
      ltpc: { ltp: 10 },
      symbol_name: "RELIANCE",
      latency: { beforeSplit: 7.6 },
    }),
    { redis, sockets: new Map() }
  );
  assert.deepEqual(redis.calls.setEx, [
    ["symbol:latency:RELIANCE", 300, "8"],
    ["symbol:latency:INE002A01018", 300, "8"],
  ]);
});

test("TC-WS-LAT-003: latency 0 (the splitter default) still streams and caches", async () => {
  const redis = fakeRedis();
  const sock = fakeSocket(["Nifty 50"]);
  await handleMarketDataMessage(
    "splited-live-data",
    kafkaMessage("NSE_INDEX|Nifty 50", { ltpc: { ltp: 24000 }, latency: { beforeSplit: 0 } }),
    { redis, sockets: new Map([["s1", sock.entry]]) }
  );
  assert.equal(sock.sent.length, 1);
  assert.deepEqual(redis.calls.setEx, [["symbol:latency:Nifty 50", 300, "0"]]);
});

test("TC-WS-LAT-004: with Redis down the tick is still pushed to sockets", async () => {
  const sock = fakeSocket(["INE002A01018"]);
  await handleMarketDataMessage(
    "splited-live-data",
    kafkaMessage("NSE_EQ|INE002A01018", { ltpc: { ltp: 1 }, latency: { beforeSplit: 3 } }),
    { redis: { isOpen: false }, sockets: new Map([["s1", sock.entry]]) }
  );
  assert.equal(sock.sent.length, 1);
});

test("TC-WS-LAT-005: backtest ticks are published on both backtest channels", async () => {
  const redis = fakeRedis();
  await handleMarketDataMessage(
    "backtest-stream-data",
    kafkaMessage("NSE_EQ|INE002A01018", { ltpc: { ltp: 5 } }),
    { redis, sockets: new Map() }
  );
  assert.deepEqual(redis.calls.publish.map((c) => c[0]), [
    "backtest:INE002A01018",
    "backtest:NSE_EQ|INE002A01018",
  ]);
});
