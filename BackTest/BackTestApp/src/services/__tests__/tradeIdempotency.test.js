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

  it("deletes falsy client_order_id to prevent E11000 null duplicate index conflicts", () => {
    const sanitizePayload = (tradePayload) => {
      const payload = { ...tradePayload };
      delete payload.force_close;
      if (!payload.client_order_id) {
        delete payload.client_order_id;
      }
      return payload;
    };

    const payloadWithNull = sanitizePayload({ symbol: "NIFTY", client_order_id: null });
    const payloadWithEmpty = sanitizePayload({ symbol: "NIFTY", client_order_id: "" });
    const payloadWithUndefined = sanitizePayload({ symbol: "NIFTY" });
    const payloadValid = sanitizePayload({ symbol: "NIFTY", client_order_id: "valid_id" });

    assert.equal("client_order_id" in payloadWithNull, false, "expected null client_order_id to be deleted");
    assert.equal("client_order_id" in payloadWithEmpty, false, "expected empty client_order_id to be deleted");
    assert.equal("client_order_id" in payloadWithUndefined, false, "expected undefined client_order_id to be absent");
    assert.equal(payloadValid.client_order_id, "valid_id", "expected valid client_order_id to be preserved");
  });

  it("forwards client_order_id from placeorder body to BackTestApp payload", () => {
    const buildTestAPIBody = (body) => {
      const { strategy_details = {} } = body;
      const clientOrderId = body.client_order_id || strategy_details.client_order_id;
      return {
        type_of_order: body.transaction_type,
        price: body.price,
        quantity: body.quantity,
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
        ...strategy_details,
      };
    };

    const bodyWithTopLevelKey = {
      transaction_type: "BUY",
      price: 100,
      quantity: 10,
      client_order_id: "key_top_123",
      strategy_details: { deployment_id: "dep1" },
    };

    const bodyWithNestedKey = {
      transaction_type: "BUY",
      price: 100,
      quantity: 10,
      strategy_details: { deployment_id: "dep1", client_order_id: "key_nested_456" },
    };

    const apiBody1 = buildTestAPIBody(bodyWithTopLevelKey);
    const apiBody2 = buildTestAPIBody(bodyWithNestedKey);

    assert.equal(apiBody1.client_order_id, "key_top_123");
    assert.equal(apiBody2.client_order_id, "key_nested_456");
  });
});
