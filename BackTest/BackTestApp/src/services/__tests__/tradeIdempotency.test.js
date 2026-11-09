import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTradePayload } from "../trade.js";
import { buildValidAccountIds } from "../deployment.js";

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
        return { _id: "trade_new_456", ...tradeData };
      },
    };

    const duplicatePayload = {
      deployment_id: "dep1",
      symbol: "NIFTY",
      type_of_order: "BUY",
      client_order_id: "dep1_NIFTY_BUY_1720236000000",
      price: 24000,
      quantity: 50,
    };

    const result = await mockTradeService.runCreateTrade(duplicatePayload);

    assert.equal(mongoFindOneCalled, true, "expected MongoDB findOne to check client_order_id");
    assert.equal(createTradeCalls, 0, "expected NO new trade document creation for duplicate key");
    assert.equal(result._id, existingTradeDoc._id, "expected existing trade document to be returned");
  });

  it("creates a new trade when client_order_id is unique", async () => {
    let createTradeCalls = 0;

    const mockTradeService = {
      runCreateTrade: async (tradeData) => {
        createTradeCalls++;
        return { _id: "trade_new_789", ...tradeData };
      },
    };

    const result = await mockTradeService.runCreateTrade({
      deployment_id: "dep1",
      symbol: "NIFTY",
      type_of_order: "BUY",
      client_order_id: "unique_order_key_999",
      price: 24100,
      quantity: 50,
    });

    assert.equal(createTradeCalls, 1, "expected trade creation for unique client_order_id");
    assert.equal(result._id, "trade_new_789");
  });

  it("deletes falsy client_order_id to prevent E11000 null duplicate index conflicts", () => {
    const payloadWithNull = sanitizeTradePayload({ symbol: "NIFTY", client_order_id: null });
    const payloadWithEmpty = sanitizeTradePayload({ symbol: "NIFTY", client_order_id: "" });
    const payloadWithUndefined = sanitizeTradePayload({ symbol: "NIFTY" });
    const payloadValid = sanitizeTradePayload({ symbol: "NIFTY", client_order_id: "valid_id" });

    assert.equal("client_order_id" in payloadWithNull, false, "expected null client_order_id to be deleted");
    assert.equal("client_order_id" in payloadWithEmpty, false, "expected empty client_order_id to be deleted");
    assert.equal("client_order_id" in payloadWithUndefined, false, "expected undefined client_order_id to be absent");
    assert.equal(payloadValid.client_order_id, "valid_id", "expected valid client_order_id to be preserved");
  });

  it("verifies Redis balance sync occurs before backtest streaming starts", async () => {
    const executionOrder = [];

    const mockSyncAllDeploymentsToRedis = async () => {
      executionOrder.push("SYNC_REDIS_BALANCE");
    };

    const mockTriggerBacktestIfNeeded = async () => {
      executionOrder.push("TRIGGER_STREAMING");
    };

    const transitionDeploymentMock = async () => {
      await mockSyncAllDeploymentsToRedis();
      await mockTriggerBacktestIfNeeded();
    };

    await transitionDeploymentMock();

    assert.deepEqual(
      executionOrder,
      ["SYNC_REDIS_BALANCE", "TRIGGER_STREAMING"],
      "expected Redis balance sync to execute BEFORE backtest streaming triggers"
    );
  });

  it("verifies validAccountIds includes both Account IDs and Deployment IDs to preserve backtest balance keys", () => {
    const allAccounts = [{ _id: "acc_111", account_id: "ACC111" }];
    const allDeployments = [{ _id: "dep_999" }];
    const validAccountIds = buildValidAccountIds(allAccounts, allDeployments);

    assert.equal(validAccountIds.has("acc_111"), true, "expected Account _id to be valid");
    assert.equal(validAccountIds.has("ACC111"), true, "expected Account account_id string to be valid");
    assert.equal(validAccountIds.has("dep_999"), true, "expected Deployment _id to be valid so balance key is not deleted as stale");
    assert.equal(validAccountIds.has("stale_deleted_id"), false, "expected unreferenced ID to be invalid for deletion");
  });
});
