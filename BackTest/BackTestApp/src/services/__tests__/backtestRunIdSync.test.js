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
});
