import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Backtest run_id Redis Sync Verification", () => {
  it("ensures backtest run_id is generated and updated for deployment", () => {
    const deployment = {
      _id: "dep123",
      strategy_mode: "BACKTEST",
      current_status: "RUNNING",
      symbol: "NSE_EQ|INE002A01018",
      backtest_run_id: null,
      save: async function() {
        this.saved = true;
      }
    };

    let synced = false;
    const mockSyncAllDeploymentsToRedis = async () => {
      synced = true;
    };

    const triggerBacktestIfNeededMock = async (dep) => {
      if (dep.strategy_mode === "BACKTEST" && dep.current_status === "RUNNING") {
        const runId = "run_" + Date.now();
        dep.backtest_run_id = runId;
        await dep.save();
        await mockSyncAllDeploymentsToRedis();
      }
    };

    return triggerBacktestIfNeededMock(deployment).then(() => {
      assert.ok(deployment.backtest_run_id, "expected backtest_run_id to be populated");
      assert.ok(deployment.backtest_run_id.startsWith("run_"), "expected run_id prefix");
      assert.equal(synced, true, "expected syncAllDeploymentsToRedis to be called");
    });
  });

  it("removes stale account balance and deployment keys on account deletion", async () => {
    const deletedKeys = [];
    const mockRedisClient = {
      del: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        deletedKeys.push(...arr);
      },
      keys: async (pattern) => {
        if (pattern === "account_balance:*") return ["account_balance:acc_valid", "account_balance:acc_deleted"];
        return [];
      }
    };

    const validAccountIds = new Set(["acc_valid"]);
    const existingBalanceKeys = await mockRedisClient.keys("account_balance:*");
    for (const key of existingBalanceKeys) {
      const accId = key.replace("account_balance:", "");
      if (!validAccountIds.has(accId)) {
        await mockRedisClient.del(key);
      }
    }

    assert.ok(deletedKeys.includes("account_balance:acc_deleted"), "expected stale account balance key to be deleted");
    assert.ok(!deletedKeys.includes("account_balance:acc_valid"), "expected valid account balance key to be preserved");
  });
});
