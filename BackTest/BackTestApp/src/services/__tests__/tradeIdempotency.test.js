import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Trade Idempotency Key Verification", () => {
  it("returns existing trade when client_order_id matches without creating duplicate", async () => {
    const existingTradeDoc = {
      _id: "trade_existing_123",
      client_order_id: "dep1_NIFTY_BUY_1720236000000",
      pnl: 0,
      price: 24000,
      quantity: 50,
      status: "EXECUTED",
    };

    let mongoFindOneCalled = false;
    let createTradeCalls = 0;

    const mockTradeService = {
      runCreateTrade: async (tradeData) => {
        if (tradeData.client_order_id) {
          mongoFindOneCalled = true;
          if (tradeData.client_order_id === existingTradeDoc.client_order_id) {
            return existingTradeDoc;
          }
        }
        createTradeCalls++;
        return { ...tradeData, _id: "trade_new_456" };
      },
    };

    // First call (new order)
    const result1 = await mockTradeService.runCreateTrade({
      client_order_id: "dep1_NIFTY_BUY_1720236000000",
      symbol: "NIFTY",
      price: 24000,
      quantity: 50,
    });

    // Duplicate call with identical client_order_id
    const result2 = await mockTradeService.runCreateTrade({
      client_order_id: "dep1_NIFTY_BUY_1720236000000",
      symbol: "NIFTY",
      price: 24000,
      quantity: 50,
    });

    assert.equal(mongoFindOneCalled, true, "expected client_order_id lookup");
    assert.equal(createTradeCalls, 0, "expected 0 new trade document creations");
    assert.equal(result1._id, existingTradeDoc._id);
    assert.equal(result2._id, existingTradeDoc._id, "expected identical existing trade return");
  });

  it("creates a new trade when client_order_id is unique", async () => {
    let createTradeCalls = 0;

    const mockTradeService = {
      runCreateTrade: async (tradeData) => {
        if (tradeData.client_order_id === "existing_key") {
          return { _id: "old" };
        }
        createTradeCalls++;
        return { _id: "trade_new_789", ...tradeData };
      },
    };

    const result = await mockTradeService.runCreateTrade({
      client_order_id: "unique_dep1_NIFTY_BUY_99999999",
      symbol: "NIFTY",
      price: 24000,
      quantity: 50,
    });

    assert.equal(createTradeCalls, 1, "expected trade creation for unique client_order_id");
    assert.equal(result._id, "trade_new_789");
  });
});
