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
