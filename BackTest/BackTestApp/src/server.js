import app, { setAppReady } from "./app.js";
import { connectDB } from "./db/connection.js";

const PORT = process.env.PORT || 4000;

// Start HTTP server immediately so port 80 is listening for reverse-proxy and probes
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Initialize WebSocket server attached to the HTTP server
try {
  const { initWebSocketServer } = await import("./services/websocketService.js");
  initWebSocketServer(server);
  console.log("✅ WebSocket server initialized successfully");
} catch (err) {
  console.error("⚠️ Failed to initialize WebSocket server:", err.message);
}

// Connect to MongoDB and run initial migrations and state sync
(async () => {
  try {
    await connectDB();

    try {
      const Strategy = (await import("./models/strategy.js")).default;
      const result = await Strategy.updateMany(
        {
          $or: [
            { target_pts: { $exists: false } },
            { sl_pts: { $exists: false } },
            { target_type: { $exists: false } },
            { target_pct: { $exists: false } },
            { sl_pct: { $exists: false } }
          ]
        },
        {
          $set: {
            target_pts: 500,
            sl_pts: 500,
            target_type: "POINTS",
            target_pct: 2,
            sl_pct: 2
          }
        }
      );
      if (result.modifiedCount > 0) {
        console.log(`✅ Migrated ${result.modifiedCount} existing strategies to default advanced settings`);
      }
    } catch (err) {
      console.error("⚠️ Failed to migrate existing strategies:", err.message);
    }

    try {
      const Deployment = (await import("./models/deployment.js")).default;
      const tfResult = await Deployment.updateMany(
        {
          $or: [
            { timeframes: { $exists: false } },
            { timeframes: null },
            { timeframes: { $size: 0 } },
          ],
        },
        { $set: { timeframes: ["1m"] }, $unset: { timeframe: "" } }
      );
      if (tfResult.modifiedCount > 0) {
        console.log(`✅ Standardized ${tfResult.modifiedCount} existing deployments to timeframes: ["1m"]`);
      }
    } catch (err) {
      console.error("⚠️ Failed to standardize deployment timeframes:", err.message);
    }

    try {
      const { syncAllDeploymentsToRedis } = await import("./services/deployment.js");
      await syncAllDeploymentsToRedis();
      console.log("✅ Initial deployment sync to Redis completed");
    } catch (err) {
      console.error("⚠️ Failed to perform initial deployment sync to Redis:", err.message);
    }

    try {
      const { syncAllActiveSymbolsToRedis } = await import("./services/symbol.js");
      await syncAllActiveSymbolsToRedis();
      console.log("✅ Initial active symbols sync to Redis completed");
    } catch (err) {
      console.error("⚠️ Failed to perform initial active symbols sync to Redis:", err.message);
    }

    try {
      const { syncOrgAccessTokenIfAdmin } = await import("./services/broker.js");
      await syncOrgAccessTokenIfAdmin();
      console.log("✅ Initial Org Upstox access token sync to Redis completed");
    } catch (err) {
      console.error("⚠️ Failed to perform initial Org Upstox access token sync to Redis:", err.message);
    }

    try {
      const { startBacktestCompletionWatcher } = await import("./services/backtestCompletionWatcher.js");
      startBacktestCompletionWatcher();
      console.log("✅ Backtest completion watcher started");
    } catch (err) {
      console.error("⚠️ Failed to start backtest completion watcher:", err.message);
    }

    setAppReady(true);
    console.log("✅ BacktestApp initialization complete — ready for incoming requests");
  } catch (err) {
    console.error("❌ Critical error during BacktestApp initialization:", err);
    process.exit(1);
  }
})();

