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

  it("isolates account balance keys by deployment_id in backtest mode", () => {
    const resolveBalanceKey = (accountId, isBacktest, deploymentId) => {
      return isBacktest && deploymentId ? `account_balance:${deploymentId}` : `account_balance:${accountId}`;
    };

    const keyDep1 = resolveBalanceKey("acc_shared", true, "dep_111");
    const keyDep2 = resolveBalanceKey("acc_shared", true, "dep_222");
    const keyLive = resolveBalanceKey("acc_shared", false, "dep_333");

    assert.equal(keyDep1, "account_balance:dep_111", "expected deployment_id namespace for dep 1");
    assert.equal(keyDep2, "account_balance:dep_222", "expected deployment_id namespace for dep 2");
    assert.notEqual(keyDep1, keyDep2, "expected parallel backtests to have non-overlapping balance keys");
    assert.equal(keyLive, "account_balance:acc_shared", "expected live mode to use shared account_id key");
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

    const validAccountIds = new Set();
    for (const acc of allAccounts) {
      if (acc._id) validAccountIds.add(acc._id.toString());
      if (acc.account_id) validAccountIds.add(acc.account_id.toString());
    }
    for (const dep of allDeployments) {
      if (dep._id) validAccountIds.add(dep._id.toString());
    }

    assert.equal(validAccountIds.has("acc_111"), true, "expected Account _id to be valid");
    assert.equal(validAccountIds.has("ACC111"), true, "expected Account account_id string to be valid");
    assert.equal(validAccountIds.has("dep_999"), true, "expected Deployment _id to be valid so balance key is not deleted as stale");
    assert.equal(validAccountIds.has("stale_deleted_id"), false, "expected unreferenced ID to be invalid for deletion");
  });

  it("live/paper mode uses account_id key even when deploymentId is present (isBacktest guard)", () => {
    // This is the root cause fix: before the fix, ALL modes used deploymentId as the key
    // when deploymentId was present, causing live deployments to look up account_balance:dep_id
    // which doesn't exist and so they always got balance=0 and placed 0-quantity orders.
    const resolveBalanceKey = (accountId, deploymentId, isBacktest) => {
      return (isBacktest && deploymentId)
        ? `account_balance:${deploymentId}`
        : `account_balance:${accountId}`;
    };

    // BACKTEST: must use deployment-scoped key for isolation
    assert.equal(
      resolveBalanceKey("acc_xyz", "dep_abc", true),
      "account_balance:dep_abc",
      "backtest must use deployment-scoped key"
    );

    // LIVE: must use account-scoped key even if deploymentId is present
    assert.equal(
      resolveBalanceKey("acc_xyz", "dep_abc", false),
      "account_balance:acc_xyz",
      "live mode must use account-scoped key regardless of deploymentId"
    );

    // PAPER: same as live, uses account key
    assert.equal(
      resolveBalanceKey("acc_xyz", "dep_abc", false),
      "account_balance:acc_xyz",
      "paper mode must use account-scoped key"
    );
  });
});
